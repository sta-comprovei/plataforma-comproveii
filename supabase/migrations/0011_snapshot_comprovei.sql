-- ============================================================================
-- TNS Gestão de Entregas — Migration 0011
-- Snapshot COMPROVEI + correção da vw_evolucao_mensal
-- ============================================================================
-- PROBLEMA IDENTIFICADO:
--   registros_comprovei tem PK=numped (1 linha por pedido, estado atual).
--   Ao reimportar julho, pedidos "Em Rota" em junho são sobrescritos com
--   status "Entregue" — o estado de junho é perdido permanentemente.
--
--   Impacto medido nos 10.864 pedidos do arquivo real:
--     • 2.301 pedidos (21,2%) ainda em rota em junho
--     • pct_entregues de junho subirá de 77% para ~98% após julho
--     • Média de transporte de junho pode inflar ~15 dias com datas de julho
--
-- SOLUÇÃO:
--   Nova tabela snapshots_comprovei com PK=(numped, competencia_import)
--   Espelha a abordagem de snapshots_rotina (migration 0010).
--
--   registros_comprovei: mantida, 1 linha/pedido, estado atual — não alterada.
--   snapshots_comprovei: nova, N linhas/pedido (1 por mês importado).
--
-- A vw_evolucao_mensal é recriada (CREATE OR REPLACE) para usar o JOIN
-- correto: snapshots_rotina ← → snapshots_comprovei pela mesma competencia_import.
-- Isso garante que dados do COMPROVEI de junho nunca sejam substituídos
-- por dados de julho ao calcular a evolução mensal.
--
-- Nenhuma tabela ou view das migrations 0008, 0009 é alterada.
-- A vw_evolucao_mensal da migration 0010 é recriada com OR REPLACE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabela: snapshots_comprovei
-- Estado de entrega por pedido × mês de importação
-- ----------------------------------------------------------------------------
create table if not exists public.snapshots_comprovei (
  numped               text not null,
  competencia_import   text not null,   -- YYYY-MM do arquivo COMPROVEI importado

  -- Estado de entrega no momento do snapshot
  numnot_comprovei     text,
  cnpj_cliente         text,
  nome_cliente         text,
  cidade_destino       text,
  uf_destino           text,
  status_entrega       text,            -- 'Entregue', 'Em Rota', 'Abortada'...
  ultima_ocorrencia    text,
  qtd_reentregas       integer not null default 0,
  motorista            text,
  cpf_motorista        text,
  placa                text,
  data_rota            timestamptz,     -- saída para entrega neste mês
  data_finalizacao     timestamptz,     -- NULL se ainda em rota neste mês
  data_ult_ocorr       timestamptz,
  data_atualizacao     timestamptz,
  base_origem          text,
  base_destino         text,

  importacao_id        uuid references public.historico_importacoes(id) on delete set null,
  criado_em            timestamptz not null default now(),

  constraint pk_snapshots_comprovei primary key (numped, competencia_import)
);

comment on table public.snapshots_comprovei is
  'Estado de entrega de cada pedido por mês de importação do COMPROVEI. '
  'Chave: (numped, competencia_import). '
  'Preserva: pedido Em Rota em junho continua como Em Rota no snapshot de junho '
  'mesmo após ser marcado Entregue em julho. '
  'Diferente de registros_comprovei (que tem sempre o estado mais recente).';

comment on column public.snapshots_comprovei.data_finalizacao is
  'NULL quando o pedido ainda estava em rota no mês deste snapshot. '
  'Preenchida somente quando a entrega ocorreu dentro da competencia_import. '
  'Este é o campo crítico: registros_comprovei terá a data de julho, '
  'mas o snapshot de junho preserva NULL (estado correto em junho).';

-- Índices
create index if not exists idx_snap_comp_numped    on public.snapshots_comprovei (numped);
create index if not exists idx_snap_comp_comp      on public.snapshots_comprovei (competencia_import);
create index if not exists idx_snap_comp_status    on public.snapshots_comprovei (status_entrega);
create index if not exists idx_snap_comp_importacao on public.snapshots_comprovei (importacao_id);

-- RLS
alter table public.snapshots_comprovei enable row level security;

drop policy if exists "sc_select_ativos" on public.snapshots_comprovei;
create policy "sc_select_ativos"
  on public.snapshots_comprovei for select
  to authenticated using (public.fn_estou_ativo());

drop policy if exists "sc_insert_admin" on public.snapshots_comprovei;
create policy "sc_insert_admin"
  on public.snapshots_comprovei for insert
  to authenticated with check (public.fn_meu_perfil() = 'administrador');

drop policy if exists "sc_update_admin" on public.snapshots_comprovei;
create policy "sc_update_admin"
  on public.snapshots_comprovei for update
  to authenticated
  using  (public.fn_meu_perfil() = 'administrador')
  with check (public.fn_meu_perfil() = 'administrador');

-- Sem DELETE — histórico não é destruído

-- Trigger auditoria
drop trigger if exists trg_auditoria_snapshots_comprovei on public.snapshots_comprovei;
create trigger trg_auditoria_snapshots_comprovei
  after insert or update on public.snapshots_comprovei
  for each row execute function public.fn_registrar_auditoria();

-- ----------------------------------------------------------------------------
-- vw_evolucao_mensal — RECRIADA com JOIN correto entre os dois snapshots
-- Antes: snapshots_rotina LEFT JOIN registros_comprovei (estado atual — errado)
-- Depois: snapshots_rotina LEFT JOIN snapshots_comprovei ON (numped E competencia)
-- ----------------------------------------------------------------------------
create or replace view public.vw_evolucao_mensal as
with base as (
  select
    s.competencia_import                          as competencia,
    -- Campos do snapshot ROTINA (datas operacionais do mês)
    s.data_pedido,
    s.datafaturamento,
    s.dtwms,
    s.datainicioos,
    s.datafimseparacao,
    s.datainicioconferencia,
    s.datafimconferencia,
    -- Campos do snapshot COMPROVEI DO MESMO MÊS
    -- JOIN por (numped, competencia_import) — garante dados contemporâneos
    c.data_rota,
    c.data_finalizacao,     -- NULL quando em rota neste mês (preservado!)
    c.status_entrega,       -- estado real neste mês
    c.cidade_destino,
    c.uf_destino,
    c.qtd_reentregas
  from public.snapshots_rotina s
  left join public.snapshots_comprovei c
    on  s.numped            = c.numped
    and s.competencia_import = c.competencia_import  -- ← mesma competência
  where s.data_pedido is not null
),
com_tempos as (
  select
    competencia,
    -- Intervalos (só positivos — filtros idênticos às outras views)
    case when datafaturamento > data_pedido
      then extract(epoch from (datafaturamento - data_pedido)) / 3600.0 end as h_venda_fat,
    case when dtwms > datafaturamento
      then extract(epoch from (dtwms - datafaturamento)) / 3600.0 end as h_fat_wms,
    case when datainicioos > dtwms
      then extract(epoch from (datainicioos - dtwms)) / 3600.0 end as h_espera_sep,
    case when datafimseparacao > datainicioos
      then extract(epoch from (datafimseparacao - datainicioos)) / 3600.0 end as h_separacao,
    case when datainicioconferencia > datafimseparacao
      then extract(epoch from (datainicioconferencia - datafimseparacao)) / 3600.0 end as h_espera_conf,
    case when datafimconferencia > datainicioconferencia
      then extract(epoch from (datafimconferencia - datainicioconferencia)) / 3600.0 end as h_conferencia,
    case when data_rota > datafimconferencia
      then extract(epoch from (data_rota - datafimconferencia)) / 3600.0 end as h_espera_transp,
    -- h_transporte: só calculável quando data_finalizacao preenchida NESTE MÊS
    case when data_finalizacao > data_rota
      then extract(epoch from (data_finalizacao - data_rota)) / 3600.0 end as h_transporte,
    case when data_finalizacao > data_pedido
      then extract(epoch from (data_finalizacao - data_pedido)) / 3600.0 end as h_lead_total,
    status_entrega,
    qtd_reentregas
  from base
)
select
  competencia,
  count(*)                                                                    as total_pedidos,
  -- Médias por etapa
  round(avg(h_venda_fat)    filter (where h_venda_fat > 0)::numeric,    2)  as media_h_venda_fat,
  round(avg(h_fat_wms)      filter (where h_fat_wms > 0)::numeric,      2)  as media_h_fat_wms,
  round(avg(h_espera_sep)   filter (where h_espera_sep > 0)::numeric,   2)  as media_h_espera_sep,
  round(avg(h_separacao)    filter (where h_separacao > 0)::numeric,    2)  as media_h_separacao,
  round(avg(h_espera_conf)  filter (where h_espera_conf > 0)::numeric,  2)  as media_h_espera_conf,
  round(avg(h_conferencia)  filter (where h_conferencia > 0)::numeric,  2)  as media_h_conferencia,
  round(avg(h_espera_transp)filter (where h_espera_transp > 0)::numeric,2)  as media_h_espera_transp,
  -- Transporte: média apenas dos pedidos entregues NESTE MÊS
  round(avg(h_transporte)   filter (where h_transporte > 0)::numeric,   2)  as media_h_transporte,
  round(avg(h_lead_total)   filter (where h_lead_total > 0)::numeric,   2)  as media_h_lead_total,
  -- Contagens
  count(*) filter (where h_venda_fat > 0)                                   as n_venda_fat,
  count(*) filter (where h_transporte > 0)                                  as n_transporte,
  count(*) filter (where h_lead_total > 0)                                  as n_lead_total,
  -- SLA: status_entrega = 'Entregue' NO SNAPSHOT DESTE MÊS
  -- Pedido em rota em junho terá status_entrega='Em Rota' → não conta aqui
  count(*) filter (where status_entrega = 'Entregue')                       as total_entregues_no_mes,
  round(
    100.0 * count(*) filter (where status_entrega = 'Entregue')
    / nullif(count(*), 0), 1
  )                                                                          as pct_entregues_no_mes,
  -- Pedidos ainda em rota no fechamento do mês
  count(*) filter (where status_entrega in ('Em Rota','A caminho','Chegou','Agendado')) as em_rota_no_mes,
  -- Reentregas no mês
  coalesce(sum(qtd_reentregas) filter (where qtd_reentregas > 0), 0)        as total_reentregas
from com_tempos
group by competencia
order by competencia desc;

comment on view public.vw_evolucao_mensal is
  'Evolução mensal com JOIN entre snapshots_rotina e snapshots_comprovei '
  'pela MESMA competencia_import. '
  'Garante que dados do COMPROVEI de junho não sejam contaminados por julho. '
  'pct_entregues_no_mes = pedidos cujo status era Entregue NESTE MÊS (não após). '
  'em_rota_no_mes = pedidos ainda em trânsito no fechamento do mês.';

-- ----------------------------------------------------------------------------
-- GRANT
-- ----------------------------------------------------------------------------
grant select on public.snapshots_comprovei to authenticated;
-- vw_evolucao_mensal já tinha GRANT na 0010 — recriada com OR REPLACE, GRANT mantido
grant select on public.vw_evolucao_mensal  to authenticated;

-- ============================================================================
-- Fim da migration 0011.
-- Tabelas/views existentes não alteradas (exceto vw_evolucao_mensal recriada
-- com OR REPLACE para corrigir o JOIN — sem breaking change para consumers).
-- ============================================================================
