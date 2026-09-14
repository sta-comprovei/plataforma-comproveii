-- ============================================================================
-- TNS Gestão de Entregas — Migration 0010
-- Histórico de snapshots mensais + Relatórios de Gargalos e Evolução Mensal
-- ============================================================================
-- Estende a migration 0009 SEM alterar nada existente.
--
-- MODELAGEM DO HISTÓRICO MENSAL (Opção B — decidida após análise):
--
--   Problema real que a tabela de snapshots resolve:
--     Um pedido de junho pode reaparecer no arquivo de julho (se ainda não
--     entregue). O upsert por NUMPED atualiza registros_rotina com o estado
--     mais recente — correto para KPIs. Mas perde o ESTADO de junho.
--
--   registros_rotina (PK=numped — mantida, não destrutivo):
--     → Sempre o estado mais recente por pedido
--     → Usado por todos os KPIs e views da Etapa 9 e 9.1
--
--   snapshots_rotina (PK=(numped, competencia_import) — nova):
--     → Estado do pedido no momento de cada importação mensal
--     → 1 linha por (pedido × mês de importação)
--     → Permite comparar "como estava em junho vs julho"
--
--   A chave de snapshot é (numped, competencia_import), onde
--   competencia_import = mês DO ARQUIVO IMPORTADO (não da data do pedido).
--   Exemplo:
--     Arquivo ROTINA de junho importado em 01/07 → competencia_import='2026-06'
--     Arquivo ROTINA de julho importado em 01/08 → competencia_import='2026-07'
--
-- NOTA SOBRE A COMPETÊNCIA EXISTENTE:
--   A coluna `competencia` em registros_rotina deriva de data_pedido (DATA).
--   Ela é IMUTÁVEL pelo dado do negócio: um pedido de junho sempre terá
--   competencia='2026-06' mesmo se reimportado em julho.
--   A snapshots_rotina.competencia_import registra o MÊS DO ARQUIVO importado.
--   São dois conceitos distintos e complementares.
--
-- Pré-requisitos: migrations 0007, 0008, 0009 aplicadas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabela: snapshots_rotina
-- Estado do pedido por mês de importação — histórico permanente
-- ----------------------------------------------------------------------------
create table if not exists public.snapshots_rotina (
  -- Chave composta: pedido × mês do arquivo importado
  numped               text not null,
  competencia_import   text not null,   -- YYYY-MM do arquivo (ex: '2026-06')

  -- Estado operacional no momento do snapshot (idêntico às colunas de registros_rotina)
  numnota              text,
  numcar               text,
  codcli               text,
  cgcent               text,
  posicao              text,
  data_pedido          timestamptz,
  dt_entrega           timestamptz,
  datafaturamento      timestamptz,
  datageracaoos        timestamptz,
  datainicioos         timestamptz,
  datafimseparacao     timestamptz,
  datainicioconferencia timestamptz,
  datafimconferencia   timestamptz,
  dtwms                timestamptz,

  -- Rastreabilidade: qual importação gerou este snapshot
  importacao_id        uuid references public.historico_importacoes(id) on delete set null,
  criado_em            timestamptz not null default now(),

  constraint pk_snapshots_rotina primary key (numped, competencia_import)
);

comment on table public.snapshots_rotina is
  'Estado de cada pedido no momento de cada importação mensal. '
  'Chave: (numped, competencia_import). '
  'Permite comparar o estado de um pedido entre competências diferentes. '
  'Diferente de registros_rotina (que tem sempre o estado mais recente).';

comment on column public.snapshots_rotina.competencia_import is
  'Mês do arquivo ROTINA importado (formato YYYY-MM). '
  'É o mês DO ARQUIVO, não necessariamente o mês da data do pedido. '
  'Ex: pedido de junho ainda no arquivo de julho → competencia_import=''2026-07''.';

-- Índices
create index if not exists idx_snap_rot_numped    on public.snapshots_rotina (numped);
create index if not exists idx_snap_rot_comp      on public.snapshots_rotina (competencia_import);
create index if not exists idx_snap_rot_importacao on public.snapshots_rotina (importacao_id);
create index if not exists idx_snap_rot_posicao   on public.snapshots_rotina (posicao);

-- RLS
alter table public.snapshots_rotina enable row level security;

drop policy if exists "sr_select_ativos" on public.snapshots_rotina;
create policy "sr_select_ativos"
  on public.snapshots_rotina for select
  to authenticated using (public.fn_estou_ativo());

drop policy if exists "sr_insert_admin" on public.snapshots_rotina;
create policy "sr_insert_admin"
  on public.snapshots_rotina for insert
  to authenticated with check (public.fn_meu_perfil() = 'administrador');

-- UPDATE permitido para corrigir dados — sem DELETE
drop policy if exists "sr_update_admin" on public.snapshots_rotina;
create policy "sr_update_admin"
  on public.snapshots_rotina for update
  to authenticated
  using  (public.fn_meu_perfil() = 'administrador')
  with check (public.fn_meu_perfil() = 'administrador');

-- Trigger de auditoria
drop trigger if exists trg_auditoria_snapshots_rotina on public.snapshots_rotina;
create trigger trg_auditoria_snapshots_rotina
  after insert or update on public.snapshots_rotina
  for each row execute function public.fn_registrar_auditoria();

-- ----------------------------------------------------------------------------
-- View: vw_ranking_gargalos
-- Relatório 1 — todas as etapas ordenadas do maior gargalo para o menor
-- Sobre registros_rotina + registros_comprovei (estado atual)
-- Calcula os mesmos 8 intervalos de vw_tempos_etapas mas já na forma de ranking
-- ----------------------------------------------------------------------------
create or replace view public.vw_ranking_gargalos as
with base as (
  select
    p.numped,
    p.data_pedido,
    p.datafaturamento,
    p.dtwms,
    p.datainicioos,
    p.datafimseparacao,
    p.datainicioconferencia,
    p.datafimconferencia,
    p.data_rota,
    p.data_finalizacao,
    r.competencia
  from public.vw_pedidos_consolidados p
  left join public.registros_rotina r on p.numped = r.numped
  where p.data_pedido is not null
),
intervalos as (
  -- 1. Venda → Faturamento
  select
    1 as ordem,
    'Venda → Faturamento' as etapa,
    'DATA → DATAFATURAMENTO' as campos_fonte,
    extract(epoch from (datafaturamento - data_pedido)) / 3600.0 as horas,
    competencia
  from base
  where datafaturamento > data_pedido

  union all

  -- 2. Faturamento → WMS
  select 2, 'Faturamento → WMS', 'DATAFATURAMENTO → DTWMS',
    extract(epoch from (dtwms - datafaturamento)) / 3600.0, competencia
  from base where dtwms > datafaturamento

  union all

  -- 3. Espera para Separação
  select 3, 'Espera Separação', 'DTWMS → DATAINICIOOS',
    extract(epoch from (datainicioos - dtwms)) / 3600.0, competencia
  from base where datainicioos > dtwms

  union all

  -- 4. Separação
  select 4, 'Separação', 'DATAINICIOOS → DATAFIMSEPARACAO',
    extract(epoch from (datafimseparacao - datainicioos)) / 3600.0, competencia
  from base where datafimseparacao > datainicioos

  union all

  -- 5. Espera para Conferência
  select 5, 'Espera Conferência', 'DATAFIMSEPARACAO → DATAINICIOCONFERENCIA',
    extract(epoch from (datainicioconferencia - datafimseparacao)) / 3600.0, competencia
  from base where datainicioconferencia > datafimseparacao

  union all

  -- 6. Conferência
  select 6, 'Conferência', 'DATAINICIOCONFERENCIA → DATAFIMCONFERENCIA',
    extract(epoch from (datafimconferencia - datainicioconferencia)) / 3600.0, competencia
  from base where datafimconferencia > datainicioconferencia

  union all

  -- 7. Espera Transporte
  select 7, 'Espera Transporte', 'DATAFIMCONFERENCIA → Data da rota',
    extract(epoch from (data_rota - datafimconferencia)) / 3600.0, competencia
  from base where data_rota > datafimconferencia

  union all

  -- 8. Transporte
  select 8, 'Transporte', 'Data da rota → Data Finalização',
    extract(epoch from (data_finalizacao - data_rota)) / 3600.0, competencia
  from base where data_finalizacao > data_rota
),
agregado as (
  select
    ordem,
    etapa,
    campos_fonte,
    count(*)                                                          as qtd_pedidos,
    round(avg(horas)::numeric, 2)                                     as media_horas,
    round(max(horas)::numeric, 2)                                     as maximo_horas,
    round(min(horas)::numeric, 2)                                     as minimo_horas,
    round(percentile_cont(0.50) within group (order by horas)::numeric, 2) as mediana_horas,
    round(percentile_cont(0.90) within group (order by horas)::numeric, 2) as p90_horas
  from intervalos
  group by ordem, etapa, campos_fonte
)
select
  *,
  rank() over (order by media_horas desc) as rank_gargalo,
  -- Classificação verde/amarelo/vermelho
  case
    when rank() over (order by media_horas desc) = 1 then 'vermelho'
    when rank() over (order by media_horas desc) <= 3 then 'amarelo'
    else 'verde'
  end as classificacao
from agregado
order by media_horas desc;   -- Ranking: maior gargalo primeiro

comment on view public.vw_ranking_gargalos is
  'Ranking de gargalos: todas as etapas ordenadas do maior tempo médio para o menor. '
  'Relatório 1 da Etapa 9.1. Inclui campos_fonte para rastreabilidade.';

-- ----------------------------------------------------------------------------
-- View: vw_evolucao_mensal
-- Relatório 2 — comparação de competências diferentes
-- Usa snapshots_rotina para permitir visão histórica real
-- (quando snapshots não existirem ainda, usa registros_rotina como fallback)
-- ----------------------------------------------------------------------------
create or replace view public.vw_evolucao_mensal as
with base_snap as (
  -- Usa snapshots quando disponíveis (histórico real por mês de importação)
  select
    s.competencia_import          as competencia,
    s.data_pedido,
    s.datafaturamento,
    s.dtwms,
    s.datainicioos,
    s.datafimseparacao,
    s.datainicioconferencia,
    s.datafimconferencia,
    -- Dados de entrega do COMPROVEI (estado atual — melhor disponível)
    c.data_rota,
    c.data_finalizacao,
    c.status_entrega,
    c.cidade_destino,
    c.uf_destino
  from public.snapshots_rotina s
  left join public.registros_comprovei c on s.numped = c.numped
  where s.data_pedido is not null
),
com_tempos as (
  select
    competencia,

    -- Intervalos de tempo em horas (só valores positivos)
    case when datafaturamento > data_pedido
      then extract(epoch from (datafaturamento - data_pedido)) / 3600.0 end
      as h_venda_fat,

    case when dtwms > datafaturamento
      then extract(epoch from (dtwms - datafaturamento)) / 3600.0 end
      as h_fat_wms,

    case when datainicioos > dtwms
      then extract(epoch from (datainicioos - dtwms)) / 3600.0 end
      as h_espera_sep,

    case when datafimseparacao > datainicioos
      then extract(epoch from (datafimseparacao - datainicioos)) / 3600.0 end
      as h_separacao,

    case when datainicioconferencia > datafimseparacao
      then extract(epoch from (datainicioconferencia - datafimseparacao)) / 3600.0 end
      as h_espera_conf,

    case when datafimconferencia > datainicioconferencia
      then extract(epoch from (datafimconferencia - datainicioconferencia)) / 3600.0 end
      as h_conferencia,

    case when data_rota > datafimconferencia
      then extract(epoch from (data_rota - datafimconferencia)) / 3600.0 end
      as h_espera_transp,

    case when data_finalizacao > data_rota
      then extract(epoch from (data_finalizacao - data_rota)) / 3600.0 end
      as h_transporte,

    case when data_finalizacao > data_pedido
      then extract(epoch from (data_finalizacao - data_pedido)) / 3600.0 end
      as h_lead_total,

    status_entrega,
    cidade_destino,
    uf_destino
  from base_snap
)
select
  competencia,
  count(*)                                                         as total_pedidos,

  -- Médias por etapa (arredondadas a 2 casas)
  round(avg(h_venda_fat)   filter (where h_venda_fat > 0)::numeric, 2)   as media_h_venda_fat,
  round(avg(h_fat_wms)     filter (where h_fat_wms > 0)::numeric, 2)     as media_h_fat_wms,
  round(avg(h_espera_sep)  filter (where h_espera_sep > 0)::numeric, 2)  as media_h_espera_sep,
  round(avg(h_separacao)   filter (where h_separacao > 0)::numeric, 2)   as media_h_separacao,
  round(avg(h_espera_conf) filter (where h_espera_conf > 0)::numeric, 2) as media_h_espera_conf,
  round(avg(h_conferencia) filter (where h_conferencia > 0)::numeric, 2) as media_h_conferencia,
  round(avg(h_espera_transp) filter (where h_espera_transp > 0)::numeric, 2) as media_h_espera_transp,
  round(avg(h_transporte)  filter (where h_transporte > 0)::numeric, 2)  as media_h_transporte,
  round(avg(h_lead_total)  filter (where h_lead_total > 0)::numeric, 2)  as media_h_lead_total,

  -- Contagens para cada etapa (n de pedidos com dado disponível)
  count(*) filter (where h_venda_fat > 0)    as n_venda_fat,
  count(*) filter (where h_transporte > 0)   as n_transporte,
  count(*) filter (where h_lead_total > 0)   as n_lead_total,

  -- Dentro do SLA: comparação com prazo_rotas
  count(*) filter (where status_entrega = 'Entregue') as total_entregues,
  round(
    100.0 * count(*) filter (where status_entrega = 'Entregue')
    / nullif(count(*), 0),
  1) as pct_entregues

from com_tempos
group by competencia
order by competencia desc;

comment on view public.vw_evolucao_mensal is
  'Evolução mensal dos lead times por competência (mês de importação). '
  'Fonte: snapshots_rotina — preserva o estado histórico de cada mês. '
  'Relatório 2 da Etapa 9.1. Ordenado do mais recente para o mais antigo.';

-- GRANTs
grant select on public.snapshots_rotina    to authenticated;
grant select on public.vw_ranking_gargalos to authenticated;
grant select on public.vw_evolucao_mensal  to authenticated;

-- ============================================================================
-- Fim da migration 0010. Nenhuma tabela/view/policy das migrations 0008/0009
-- foi alterada.
-- ============================================================================
