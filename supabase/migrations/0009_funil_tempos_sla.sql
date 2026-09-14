-- ============================================================================
-- TNS Gestão de Entregas — Migration 0009
-- Etapa 9.1: Complemento do Funil Operacional (Tempos, Histórico e SLA)
-- ============================================================================
-- Extensão da migration 0008 (Etapa 9). NÃO altera nenhuma tabela, view ou
-- policy existente. Apenas adiciona:
--
--   1. Coluna `competencia` em registros_rotina e registros_comprovei
--      (histórico mensal — dados de meses diferentes coexistem)
--
--   2. Tabela `prazo_rotas` — cadastro de prazos por destino
--
--   3. View `vw_tempos_etapas` — lead time por etapa em horas, com
--      agregações (média, máximo, contagem) para o painel de gargalos
--
--   4. View `vw_gargalos_etapas` — resumo de gargalos com classificação
--      automática verde/amarelo/vermelho
--
--   5. View `vw_sla_entregas` — comparação tempo real vs prazo da rota
--
--   6. View `vw_alertas_operacionais` — top motoristas/rotas com atraso
--
-- Pré-requisitos (já existentes após migration 0008):
--   - registros_rotina, registros_comprovei, vw_pedidos_consolidados
--   - fn_registrar_auditoria, fn_estou_ativo, fn_meu_perfil
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 3: Competência — histórico mensal permanente
-- Adicionada às duas tabelas de negócio como coluna gerada
-- (não modifica constraints existentes, apenas adiciona coluna nullable)
-- ─────────────────────────────────────────────────────────────────────────

-- Coluna competencia em registros_rotina
-- Formato YYYY-MM derivado da data_pedido; preenchida pelo service no import.
-- NULL para registros antigos já importados (compatibilidade retroativa).
alter table public.registros_rotina
  add column if not exists competencia text;  -- ex: '2026-06', '2026-07'

comment on column public.registros_rotina.competencia is
  'Competência do registro no formato YYYY-MM (ex: 2026-06). '
  'Derivada de data_pedido no momento da importação. '
  'Permite histórico mensal permanente: importações de meses diferentes coexistem.';

-- Coluna competencia em registros_comprovei
alter table public.registros_comprovei
  add column if not exists competencia text;

comment on column public.registros_comprovei.competencia is
  'Competência do registro no formato YYYY-MM (ex: 2026-06). '
  'Derivada de data_rota no momento da importação. '
  'Permite histórico mensal permanente: meses diferentes coexistem.';

-- Índices para filtro por competência
create index if not exists idx_rot_competencia  on public.registros_rotina  (competencia);
create index if not exists idx_comp_competencia on public.registros_comprovei (competencia);

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 5: Tabela prazo_rotas — cadastro de prazos por destino
-- Apenas as rotas efetivamente atendidas (não lista de municípios do Brasil)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.prazo_rotas (
  id          uuid primary key default gen_random_uuid(),

  rota        text not null,           -- nome do destino/rota (ex: 'BRASILIA')
  codigo_rota text,                    -- código interno da rota
  uf          text,                    -- UF de destino (ex: 'DF', 'GO')
  distancia_km numeric(8,1),           -- distância em km (opcional)
  prazo_dias  integer not null check (prazo_dias > 0),  -- prazo em dias corridos
  ativo       boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Unicidade: uma rota por nome+UF (permite mesmo nome em UFs diferentes)
  constraint uq_prazo_rota_uf unique (rota, uf)
);

comment on table public.prazo_rotas is
  'Cadastro de prazos de entrega por rota/destino. '
  'Apenas as rotas efetivamente atendidas pela operação. '
  'Usado para calcular SLA (Parte 6 da Etapa 9.1).';

comment on column public.prazo_rotas.prazo_dias is
  'Prazo em dias corridos. Ex: BRASILIA=1, GOIANIA=1, JUAZEIRO=12, PRESIDENTE DUTRA=10.';

-- Seed inicial com as rotas mais frequentes encontradas nos dados reais
-- (ROTINA8072.xls / documentSAC CSV — top 15 cidades de destino)
insert into public.prazo_rotas (rota, uf, prazo_dias) values
  ('BRASILIA',                    'DF', 1),
  ('GOIANIA',                     'GO', 1),
  ('VALPARAISO DE GOIAS',         'GO', 1),
  ('LUZIANIA',                    'GO', 1),
  ('AGUAS LINDAS DE GOIAS',       'GO', 1),
  ('FORMOSA',                     'GO', 2),
  ('APARECIDA DE GOIANIA',        'GO', 1),
  ('PLANALTINA',                  'GO', 1),
  ('SANTO ANTONIO DO DESCOBERTO', 'GO', 1),
  ('CRISTALINA',                  'GO', 2),
  ('UNAI',                        'MG', 2),
  ('CIDADE OCIDENTAL',            'GO', 1),
  ('SAO PAULO',                   'SP', 3),
  ('NOVO GAMA',                   'GO', 1),
  ('ALTO PARAISO DE GOIAS',       'GO', 2),
  ('AGUAS CLARAS',                'DF', 1),
  ('AGUAS LINDAS',                'GO', 1),
  ('ALEXANIA',                    'GO', 1)
on conflict (rota, uf) do nothing;

-- RLS em prazo_rotas
alter table public.prazo_rotas enable row level security;

drop policy if exists "pr_select_ativos" on public.prazo_rotas;
create policy "pr_select_ativos"
  on public.prazo_rotas for select
  to authenticated using (public.fn_estou_ativo());

drop policy if exists "pr_insert_admin" on public.prazo_rotas;
create policy "pr_insert_admin"
  on public.prazo_rotas for insert
  to authenticated with check (public.fn_meu_perfil() = 'administrador');

drop policy if exists "pr_update_admin" on public.prazo_rotas;
create policy "pr_update_admin"
  on public.prazo_rotas for update
  to authenticated
  using (public.fn_meu_perfil() = 'administrador')
  with check (public.fn_meu_perfil() = 'administrador');

-- Sem policy DELETE — inativar em vez de excluir
-- Trigger de auditoria
drop trigger if exists trg_auditoria_prazo_rotas on public.prazo_rotas;
create trigger trg_auditoria_prazo_rotas
  after insert or update on public.prazo_rotas
  for each row execute function public.fn_registrar_auditoria();

-- Trigger para updated_at automático
create or replace function public.fn_prazo_rotas_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_prazo_rotas_updated_at on public.prazo_rotas;
create trigger trg_prazo_rotas_updated_at
  before update on public.prazo_rotas
  for each row execute function public.fn_prazo_rotas_set_updated_at();

-- Índices
create index if not exists idx_prazo_rota_nome on public.prazo_rotas (rota);
create index if not exists idx_prazo_rota_uf   on public.prazo_rotas (uf);
create index if not exists idx_prazo_rota_ativo on public.prazo_rotas (ativo);

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 1 + 2: View vw_tempos_etapas
-- Calcula os 8 intervalos de tempo por pedido
-- Fonte: vw_pedidos_consolidados (já existente na migration 0008)
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_tempos_etapas as
select
  numped,
  competencia_rotina,
  motorista,
  cidade_destino,
  uf_destino,
  status_entrega,

  -- ── Intervalo 1: Venda → Faturamento ─────────────────────────────────────
  -- DATA (data_pedido) → DATAFATURAMENTO
  extract(epoch from (datafaturamento - data_pedido)) / 3600.0
    as h_venda_faturamento,

  -- ── Intervalo 2: Faturamento → WMS (Expedição) ───────────────────────────
  -- DATAFATURAMENTO → DTWMS
  extract(epoch from (dtwms - datafaturamento)) / 3600.0
    as h_faturamento_wms,

  -- ── Intervalo 3: Espera para Separação ───────────────────────────────────
  -- DTWMS → DATAINICIOOS
  extract(epoch from (datainicioos - dtwms)) / 3600.0
    as h_espera_separacao,

  -- ── Intervalo 4: Tempo de Separação ──────────────────────────────────────
  -- DATAINICIOOS → DATAFIMSEPARACAO
  extract(epoch from (datafimseparacao - datainicioos)) / 3600.0
    as h_separacao,

  -- ── Intervalo 5: Espera para Conferência ─────────────────────────────────
  -- DATAFIMSEPARACAO → DATAINICIOCONFERENCIA
  extract(epoch from (datainicioconferencia - datafimseparacao)) / 3600.0
    as h_espera_conferencia,

  -- ── Intervalo 6: Tempo de Conferência ────────────────────────────────────
  -- DATAINICIOCONFERENCIA → DATAFIMCONFERENCIA
  extract(epoch from (datafimconferencia - datainicioconferencia)) / 3600.0
    as h_conferencia,

  -- ── Intervalo 7: Espera para Expedição / Transporte ──────────────────────
  -- DATAFIMCONFERENCIA → data_rota (COMPROVEI)
  extract(epoch from (data_rota - datafimconferencia)) / 3600.0
    as h_espera_transporte,

  -- ── Intervalo 8: Tempo em Transporte ─────────────────────────────────────
  -- data_rota (COMPROVEI) → data_finalizacao (COMPROVEI)
  extract(epoch from (data_finalizacao - data_rota)) / 3600.0
    as h_transporte,

  -- ── Lead Time Total: Venda → Entrega ─────────────────────────────────────
  extract(epoch from (data_finalizacao - data_pedido)) / 3600.0
    as h_lead_time_total

from (
  -- Subconsulta para incluir competencia da ROTINA
  select
    p.*,
    r.competencia as competencia_rotina
  from public.vw_pedidos_consolidados p
  left join public.registros_rotina r on p.numped = r.numped
) sub
where
  -- Excluir intervalos com valores negativos ou impossíveis
  -- (dados inconsistentes no arquivo de origem)
  data_pedido is not null;

comment on view public.vw_tempos_etapas is
  'Lead time em horas para cada uma das 8 etapas do funil. '
  'Valores negativos indicam inconsistência de dados na fonte. '
  'Fonte: vw_pedidos_consolidados (Etapa 9) + competencia de registros_rotina.';

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 2: View vw_gargalos_etapas
-- Agrega tempos por etapa e classifica automaticamente
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_gargalos_etapas as
with etapas as (
  -- Pivotar os intervalos em linhas para facilitar agregação
  select numped, competencia_rotina, motorista, cidade_destino,
         'Venda → Faturamento'     as etapa, 1 as ordem,
         h_venda_faturamento       as horas
  from public.vw_tempos_etapas
  where h_venda_faturamento > 0

  union all
  select numped, competencia_rotina, motorista, cidade_destino,
         'Faturamento → WMS'       as etapa, 2 as ordem,
         h_faturamento_wms         as horas
  from public.vw_tempos_etapas
  where h_faturamento_wms > 0

  union all
  select numped, competencia_rotina, motorista, cidade_destino,
         'Espera Separação'        as etapa, 3 as ordem,
         h_espera_separacao        as horas
  from public.vw_tempos_etapas
  where h_espera_separacao > 0

  union all
  select numped, competencia_rotina, motorista, cidade_destino,
         'Separação'               as etapa, 4 as ordem,
         h_separacao               as horas
  from public.vw_tempos_etapas
  where h_separacao > 0

  union all
  select numped, competencia_rotina, motorista, cidade_destino,
         'Espera Conferência'      as etapa, 5 as ordem,
         h_espera_conferencia      as horas
  from public.vw_tempos_etapas
  where h_espera_conferencia > 0

  union all
  select numped, competencia_rotina, motorista, cidade_destino,
         'Conferência'             as etapa, 6 as ordem,
         h_conferencia             as horas
  from public.vw_tempos_etapas
  where h_conferencia > 0

  union all
  select numped, competencia_rotina, motorista, cidade_destino,
         'Espera Transporte'       as etapa, 7 as ordem,
         h_espera_transporte       as horas
  from public.vw_tempos_etapas
  where h_espera_transporte > 0

  union all
  select numped, competencia_rotina, motorista, cidade_destino,
         'Transporte'              as etapa, 8 as ordem,
         h_transporte              as horas
  from public.vw_tempos_etapas
  where h_transporte > 0
),
agregado as (
  select
    etapa,
    ordem,
    count(*)                     as qtd_pedidos,
    round(avg(horas)::numeric, 2)  as media_horas,
    round(max(horas)::numeric, 2)  as maximo_horas,
    round(median(horas)::numeric, 2) as mediana_horas,
    -- Percentis para detecção de outliers
    round(percentile_cont(0.75) within group (order by horas)::numeric, 2) as p75_horas,
    round(percentile_cont(0.90) within group (order by horas)::numeric, 2) as p90_horas
  from etapas
  group by etapa, ordem
),
com_rank as (
  select *,
    -- Classificação relativa entre etapas (qual é a mais lenta em média)
    rank() over (order by media_horas desc) as rank_lentidao
  from agregado
)
select
  etapa,
  ordem,
  qtd_pedidos,
  media_horas,
  maximo_horas,
  mediana_horas,
  p75_horas,
  p90_horas,
  rank_lentidao,

  -- Classificação automática de gargalo
  -- Verde: etapa mais rápida (rank > total * 0.6)
  -- Vermelho: etapa mais lenta (rank = 1)
  -- Amarelo: atenção (demais)
  case
    when rank_lentidao = 1
      then 'vermelho'   -- gargalo principal
    when rank_lentidao <= 3
      then 'amarelo'    -- atenção
    else
      'verde'           -- dentro do esperado
  end as classificacao

from com_rank
order by ordem;

comment on view public.vw_gargalos_etapas is
  'Tempos médios/máximos por etapa do funil com classificação automática de gargalo. '
  'vermelho = etapa mais lenta, amarelo = atenção, verde = dentro do esperado.';

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 6: View vw_sla_entregas
-- Compara tempo real de transporte com prazo cadastrado na prazo_rotas
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_sla_entregas as
select
  t.numped,
  t.motorista,
  t.cidade_destino,
  t.uf_destino,
  t.status_entrega,
  t.competencia_rotina,
  t.h_transporte,

  -- Prazo cadastrado (em horas para comparação uniforme)
  p.prazo_dias,
  (p.prazo_dias * 24)::numeric as prazo_horas,

  -- Diferença: positivo = atrasado, negativo = antecipado
  round((t.h_transporte - (p.prazo_dias * 24))::numeric, 2) as diferenca_horas,

  -- Dias de diferença (mais legível para a operação)
  round((t.h_transporte - (p.prazo_dias * 24))::numeric / 24, 2) as diferenca_dias,

  -- Classificação do SLA
  case
    when t.h_transporte is null or p.prazo_dias is null
      then 'sem_dados'
    when t.h_transporte <= (p.prazo_dias * 24)
      then 'dentro_prazo'
    when t.h_transporte <= (p.prazo_dias * 24 * 1.1)  -- até 10% de tolerância
      then 'dentro_prazo'
    else
      'atrasado'
  end as sla_status

from public.vw_tempos_etapas t
left join public.prazo_rotas p
  on upper(trim(t.cidade_destino)) = upper(trim(p.rota))
  and (t.uf_destino is null or upper(trim(t.uf_destino)) = upper(trim(p.uf)))
  and p.ativo = true
where
  t.h_transporte is not null
  and t.h_transporte > 0;

comment on view public.vw_sla_entregas is
  'Comparação entre o tempo real de transporte e o prazo cadastrado em prazo_rotas. '
  'sla_status: dentro_prazo | atrasado | sem_dados (rota não cadastrada).';

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 6: View vw_sla_kpis — indicadores consolidados de SLA
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_sla_kpis as
select
  -- Volume total com SLA calculável
  count(*) filter (where sla_status != 'sem_dados') as total_com_sla,
  count(*) filter (where sla_status = 'sem_dados')  as total_sem_rota_cadastrada,

  -- Dentro do prazo
  count(*) filter (where sla_status = 'dentro_prazo')   as total_dentro_prazo,
  round(
    100.0 * count(*) filter (where sla_status = 'dentro_prazo')
    / nullif(count(*) filter (where sla_status != 'sem_dados'), 0),
  1) as pct_dentro_prazo,

  -- Atrasados
  count(*) filter (where sla_status = 'atrasado')   as total_atrasado,
  round(
    100.0 * count(*) filter (where sla_status = 'atrasado')
    / nullif(count(*) filter (where sla_status != 'sem_dados'), 0),
  1) as pct_atrasado,

  -- Atraso médio (apenas os atrasados)
  round(avg(diferenca_dias) filter (where sla_status = 'atrasado')::numeric, 2)
    as atraso_medio_dias,

  -- Atraso máximo
  round(max(diferenca_dias) filter (where sla_status = 'atrasado')::numeric, 2)
    as atraso_maximo_dias

from public.vw_sla_entregas;

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 7: View vw_alertas_operacionais
-- Top motoristas/rotas/pedidos com maior atraso ou tempo
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_alertas_operacionais as
-- Rotas com maior atraso médio (top 10)
select
  'rota_mais_atrasada'   as tipo_alerta,
  cidade_destino         as entidade,
  uf_destino             as detalhe,
  round(avg(diferenca_dias)::numeric, 2) as valor_dias,
  count(*)               as qtd_pedidos
from public.vw_sla_entregas
where sla_status = 'atrasado'
group by cidade_destino, uf_destino
having count(*) >= 2  -- mínimo 2 pedidos para evitar ruído
order by avg(diferenca_dias) desc
limit 10;

comment on view public.vw_alertas_operacionais is
  'Alertas automáticos: rotas com maior atraso médio (mínimo 2 pedidos).';

-- ─────────────────────────────────────────────────────────────────────────
-- GRANTs para as novas views
-- ─────────────────────────────────────────────────────────────────────────
grant select on public.vw_tempos_etapas        to authenticated;
grant select on public.vw_gargalos_etapas      to authenticated;
grant select on public.vw_sla_entregas         to authenticated;
grant select on public.vw_sla_kpis             to authenticated;
grant select on public.vw_alertas_operacionais to authenticated;
grant select on public.prazo_rotas             to authenticated;

-- ============================================================================
-- Fim da migration 0009. Nenhuma tabela, view ou policy existente foi alterada.
-- ============================================================================
