-- ============================================================================
-- TNS Gestão de Entregas — Migration 0012
-- Evolução de Gargalos · SLA com Tolerância · Performance de Rotas · Histórico
-- ============================================================================
-- Estende migrations 0009–0011 SEM alterar nada existente.
-- Todas as views novas usam snapshots_rotina + snapshots_comprovei para
-- qualquer consulta com filtro de competência (Ponto 4 obrigatório).
--
-- O que é criado:
--   1. ALTER TABLE prazo_rotas → ADD COLUMN prazo_horas, tolerancia_percentual
--   2. vw_sla_entregas_com_tolerancia  (recria vw_sla_entregas com tolerância real)
--   3. vw_sla_kpis_com_tolerancia      (KPIs usando a nova classificação)
--   4. vw_performance_rotas            (ranking rota: pior → melhor, usa snapshots)
--   5. vw_evolucao_gargalos            (evolução mensal por etapa com variação %)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Adicionar prazo_horas e tolerancia_percentual em prazo_rotas
--    prazo_horas: campo explícito em horas (mais preciso que prazo_dias*24)
--    tolerancia_percentual: faixa de tolerância (padrão 20%)
-- ----------------------------------------------------------------------------
alter table public.prazo_rotas
  add column if not exists prazo_horas           numeric(8,2),
  add column if not exists tolerancia_percentual numeric(5,2) not null default 20.00;

comment on column public.prazo_rotas.prazo_horas is
  'Prazo em horas (mais preciso que prazo_dias). '
  'Quando preenchido, tem precedência sobre prazo_dias para cálculo do SLA. '
  'Ex: 48.0 para Brasília (2 dias). Se NULL, usa prazo_dias * 24.';

comment on column public.prazo_rotas.tolerancia_percentual is
  'Faixa de tolerância do SLA em percentual. Padrão: 20%. '
  'Limite real = prazo_horas * (1 + tolerancia_percentual/100). '
  'Ex: 48h × 1,20 = 57,6h. Entre 90% e 100% do limite → amarelo.';

-- Atualizar o seed existente com prazo_horas explícito (prazo_dias * 24)
-- Usa ON CONFLICT DO UPDATE para sincronizar sem duplicar
update public.prazo_rotas
  set prazo_horas = prazo_dias * 24
  where prazo_horas is null;

-- ----------------------------------------------------------------------------
-- 2. vw_sla_entregas_com_tolerancia
--    Substitui a lógica de tolerância fixa (10%) por tolerancia_percentual
--    da tabela prazo_rotas. Usa snapshots para modo histórico (competencia).
--    Mantém vw_sla_entregas da 0009 intacta — nova view é aditiva.
-- ----------------------------------------------------------------------------
create or replace view public.vw_sla_entregas_com_tolerancia as
with base as (
  -- Fonte primária: snapshots_comprovei (histórico real por competência)
  -- Quando competencia_import é NULL não há snapshot → fallback para registros
  select
    sc.numped,
    sc.competencia_import,
    sc.motorista,
    sc.cidade_destino,
    sc.uf_destino,
    sc.status_entrega,
    sc.data_rota,
    sc.data_finalizacao,
    -- Tempo de transporte em horas
    case
      when sc.data_finalizacao > sc.data_rota
        then extract(epoch from (sc.data_finalizacao - sc.data_rota)) / 3600.0
    end as h_transporte
  from public.snapshots_comprovei sc
  where sc.data_rota is not null

  union all

  -- Fallback: registros_comprovei para pedidos sem snapshot
  -- (pedidos importados antes da migration 0011)
  select
    rc.numped,
    rc.competencia     as competencia_import,
    rc.motorista,
    rc.cidade_destino,
    rc.uf_destino,
    rc.status_entrega,
    rc.data_rota,
    rc.data_finalizacao,
    case
      when rc.data_finalizacao > rc.data_rota
        then extract(epoch from (rc.data_finalizacao - rc.data_rota)) / 3600.0
    end as h_transporte
  from public.registros_comprovei rc
  where rc.data_rota is not null
    -- excluir os que já têm snapshot (evitar duplicata)
    and not exists (
      select 1 from public.snapshots_comprovei sc2
      where sc2.numped = rc.numped
    )
),
com_prazo as (
  select
    b.*,
    -- Prazo efetivo em horas: prazo_horas tem precedência sobre prazo_dias*24
    coalesce(p.prazo_horas, p.prazo_dias * 24) as prazo_horas_efetivo,
    p.tolerancia_percentual,
    p.prazo_dias,
    p.rota as rota_cadastrada
  from base b
  left join public.prazo_rotas p
    on  upper(trim(b.cidade_destino)) = upper(trim(p.rota))
    and (b.uf_destino is null or upper(trim(b.uf_destino)) = upper(trim(p.uf)))
    and p.ativo = true
  where b.h_transporte > 0
)
select
  numped,
  competencia_import,
  motorista,
  cidade_destino,
  uf_destino,
  status_entrega,
  data_rota,
  data_finalizacao,
  round(h_transporte::numeric, 2)             as h_transporte,
  prazo_horas_efetivo,
  tolerancia_percentual,
  prazo_dias,
  rota_cadastrada,

  -- Limite com tolerância: ex. 48h × 1,20 = 57,6h
  round((prazo_horas_efetivo * (1 + tolerancia_percentual / 100.0))::numeric, 2)
    as limite_com_tolerancia,

  -- Diferença em relação ao prazo base
  round((h_transporte - prazo_horas_efetivo)::numeric, 2) as diferenca_horas,
  round((h_transporte - prazo_horas_efetivo)::numeric / 24, 2) as diferenca_dias,

  -- Percentual do prazo utilizado
  case
    when prazo_horas_efetivo > 0
      then round((h_transporte / prazo_horas_efetivo * 100)::numeric, 1)
  end as pct_prazo_utilizado,

  -- Classificação com tolerância real:
  --   verde:    ≤ 100% do prazo
  --   amarelo:  entre 90% e 100% do limite com tolerância
  --   vermelho: > limite com tolerância
  case
    when prazo_horas_efetivo is null
      then 'sem_dados'
    when h_transporte <= prazo_horas_efetivo
      then 'verde'
    when h_transporte <= prazo_horas_efetivo * (1 + tolerancia_percentual / 100.0)
      then 'amarelo'
    else
      'vermelho'
  end as sla_status

from com_prazo;

comment on view public.vw_sla_entregas_com_tolerancia is
  'SLA com tolerância por rota. '
  'verde: dentro do prazo | amarelo: na faixa de tolerância | vermelho: acima do limite. '
  'Usa snapshots_comprovei para histórico; fallback para registros_comprovei.';

-- ----------------------------------------------------------------------------
-- 3. vw_sla_kpis_com_tolerancia — indicadores com a nova classificação
-- ----------------------------------------------------------------------------
create or replace view public.vw_sla_kpis_com_tolerancia as
select
  count(*) filter (where sla_status != 'sem_dados')  as total_com_sla,
  count(*) filter (where sla_status = 'sem_dados')   as total_sem_rota,

  count(*) filter (where sla_status = 'verde')       as total_verde,
  round(100.0 * count(*) filter (where sla_status = 'verde')
    / nullif(count(*) filter (where sla_status != 'sem_dados'), 0), 1) as pct_verde,

  count(*) filter (where sla_status = 'amarelo')     as total_amarelo,
  round(100.0 * count(*) filter (where sla_status = 'amarelo')
    / nullif(count(*) filter (where sla_status != 'sem_dados'), 0), 1) as pct_amarelo,

  count(*) filter (where sla_status = 'vermelho')    as total_vermelho,
  round(100.0 * count(*) filter (where sla_status = 'vermelho')
    / nullif(count(*) filter (where sla_status != 'sem_dados'), 0), 1) as pct_vermelho,

  round(avg(diferenca_horas) filter (where sla_status = 'vermelho')::numeric / 24, 2)
    as atraso_medio_dias_vermelho,
  round(max(diferenca_horas) filter (where sla_status = 'vermelho')::numeric / 24, 2)
    as atraso_maximo_dias_vermelho

from public.vw_sla_entregas_com_tolerancia;

-- ----------------------------------------------------------------------------
-- 4. vw_performance_rotas — ranking da pior para a melhor rota
--    Usa snapshots_comprovei (histórico). Fallback para registros_comprovei.
-- ----------------------------------------------------------------------------
create or replace view public.vw_performance_rotas as
select
  cidade_destino,
  uf_destino,
  rota_cadastrada,
  prazo_horas_efetivo,
  tolerancia_percentual,

  count(*)                                                      as total_entregas,
  round(avg(h_transporte)::numeric, 2)                         as media_h_transporte,
  round(max(h_transporte)::numeric, 2)                         as maximo_h_transporte,
  round(min(h_transporte)::numeric, 2)                         as minimo_h_transporte,

  -- SLA por classificação
  count(*) filter (where sla_status = 'verde')                 as qtd_verde,
  count(*) filter (where sla_status = 'amarelo')               as qtd_amarelo,
  count(*) filter (where sla_status = 'vermelho')              as qtd_vermelho,
  count(*) filter (where sla_status = 'sem_dados')             as qtd_sem_dados,

  -- Percentuais
  round(100.0 * count(*) filter (where sla_status = 'verde')
    / nullif(count(*) filter (where sla_status != 'sem_dados'), 0), 1) as pct_verde,
  round(100.0 * count(*) filter (where sla_status = 'amarelo')
    / nullif(count(*) filter (where sla_status != 'sem_dados'), 0), 1) as pct_amarelo,
  round(100.0 * count(*) filter (where sla_status = 'vermelho')
    / nullif(count(*) filter (where sla_status != 'sem_dados'), 0), 1) as pct_vermelho,

  -- Atraso médio nos vermelhos
  round(avg(diferenca_horas) filter (where sla_status = 'vermelho')::numeric / 24, 2)
    as atraso_medio_dias,

  -- Classificação geral da rota (pior status predominante)
  case
    when count(*) filter (where sla_status = 'sem_dados') = count(*) then 'sem_dados'
    when round(100.0 * count(*) filter (where sla_status = 'vermelho')
      / nullif(count(*) filter (where sla_status != 'sem_dados'), 0), 1) > 30
      then 'critica'      -- > 30% vermelho
    when round(100.0 * count(*) filter (where sla_status in ('amarelo','vermelho'))
      / nullif(count(*) filter (where sla_status != 'sem_dados'), 0), 1) > 40
      then 'atencao'      -- > 40% amarelo+vermelho
    else 'ok'
  end as classificacao_rota

from public.vw_sla_entregas_com_tolerancia
where cidade_destino is not null
group by cidade_destino, uf_destino, rota_cadastrada, prazo_horas_efetivo, tolerancia_percentual
-- Ordenar: pior rota primeiro (maior % vermelho, depois maior média de transporte)
order by
  pct_vermelho desc nulls last,
  media_h_transporte desc nulls last;

comment on view public.vw_performance_rotas is
  'Ranking de rotas: pior para melhor. '
  'classificacao_rota: critica (>30% vermelho) | atencao (>40% amarelo+vermelho) | ok. '
  'Usa vw_sla_entregas_com_tolerancia (snapshots + fallback).';

-- ----------------------------------------------------------------------------
-- 5. vw_evolucao_gargalos — evolução mensal com variação em relação ao mês anterior
--    Usa EXCLUSIVAMENTE snapshots_rotina + snapshots_comprovei (Ponto 4)
-- ----------------------------------------------------------------------------
create or replace view public.vw_evolucao_gargalos as
with intervalos_por_comp as (
  -- Calcular os 7 intervalos por pedido × competência, usando APENAS snapshots
  select
    sr.competencia_import as competencia,
    -- 1. Venda → Faturamento
    case when sr.datafaturamento > sr.data_pedido
      then extract(epoch from (sr.datafaturamento - sr.data_pedido)) / 3600.0 end  as h1,
    -- 2. Faturamento → WMS
    case when sr.dtwms > sr.datafaturamento
      then extract(epoch from (sr.dtwms - sr.datafaturamento)) / 3600.0 end        as h2,
    -- 3. WMS → Separação (espera + execução)
    case when sr.datafimseparacao > sr.dtwms
      then extract(epoch from (sr.datafimseparacao - sr.dtwms)) / 3600.0 end       as h3,
    -- 4. Separação → Conferência (espera + execução)
    case when sr.datafimconferencia > sr.datafimseparacao
      then extract(epoch from (sr.datafimconferencia - sr.datafimseparacao)) / 3600.0 end as h4,
    -- 5. Conferência → Expedição (DATAFIMCONFERENCIA → DTWMS_rota = data_rota do COMPROVEI)
    case when sc.data_rota > sr.datafimconferencia
      then extract(epoch from (sc.data_rota - sr.datafimconferencia)) / 3600.0 end as h5,
    -- 6. Expedição → Transporte (data_rota → data_finalizacao, apenas entregas deste mês)
    case when sc.data_finalizacao > sc.data_rota
      then extract(epoch from (sc.data_finalizacao - sc.data_rota)) / 3600.0 end   as h6,
    -- 7. Lead time total: Venda → Entrega
    case when sc.data_finalizacao > sr.data_pedido
      then extract(epoch from (sc.data_finalizacao - sr.data_pedido)) / 3600.0 end as h7

  from public.snapshots_rotina sr
  -- JOIN pelo mesmo mês — dados contemporâneos, não mistura de épocas
  left join public.snapshots_comprovei sc
    on  sr.numped            = sc.numped
    and sr.competencia_import = sc.competencia_import
  where sr.data_pedido is not null
),
agregado as (
  select
    competencia,
    -- Médias (apenas valores positivos)
    round(avg(h1) filter (where h1 > 0)::numeric, 2) as media_h1,
    round(avg(h2) filter (where h2 > 0)::numeric, 2) as media_h2,
    round(avg(h3) filter (where h3 > 0)::numeric, 2) as media_h3,
    round(avg(h4) filter (where h4 > 0)::numeric, 2) as media_h4,
    round(avg(h5) filter (where h5 > 0)::numeric, 2) as media_h5,
    round(avg(h6) filter (where h6 > 0)::numeric, 2) as media_h6,
    round(avg(h7) filter (where h7 > 0)::numeric, 2) as media_h7,
    -- Máximos
    round(max(h1) filter (where h1 > 0)::numeric, 2) as max_h1,
    round(max(h2) filter (where h2 > 0)::numeric, 2) as max_h2,
    round(max(h3) filter (where h3 > 0)::numeric, 2) as max_h3,
    round(max(h4) filter (where h4 > 0)::numeric, 2) as max_h4,
    round(max(h5) filter (where h5 > 0)::numeric, 2) as max_h5,
    round(max(h6) filter (where h6 > 0)::numeric, 2) as max_h6,
    round(max(h7) filter (where h7 > 0)::numeric, 2) as max_h7,
    -- Contagens
    count(*) filter (where h1 > 0) as n1,
    count(*) filter (where h2 > 0) as n2,
    count(*) filter (where h3 > 0) as n3,
    count(*) filter (where h4 > 0) as n4,
    count(*) filter (where h5 > 0) as n5,
    count(*) filter (where h6 > 0) as n6,
    count(*) filter (where h7 > 0) as n7,
    count(*)                       as total_pedidos
  from intervalos_por_comp
  group by competencia
),
com_variacao as (
  select
    *,
    -- Variação em relação ao mês anterior (usando LAG)
    -- Positivo = piorou (demorou mais); negativo = melhorou (demorou menos)
    lag(media_h1) over (order by competencia) as prev_h1,
    lag(media_h2) over (order by competencia) as prev_h2,
    lag(media_h3) over (order by competencia) as prev_h3,
    lag(media_h4) over (order by competencia) as prev_h4,
    lag(media_h5) over (order by competencia) as prev_h5,
    lag(media_h6) over (order by competencia) as prev_h6,
    lag(media_h7) over (order by competencia) as prev_h7
  from agregado
)
select
  competencia,
  total_pedidos,

  -- Intervalo 1: Venda → Faturamento
  media_h1, max_h1, n1,
  round(((media_h1 - prev_h1) / nullif(prev_h1, 0) * 100)::numeric, 1) as var_pct_h1,

  -- Intervalo 2: Faturamento → WMS
  media_h2, max_h2, n2,
  round(((media_h2 - prev_h2) / nullif(prev_h2, 0) * 100)::numeric, 1) as var_pct_h2,

  -- Intervalo 3: WMS → Separação
  media_h3, max_h3, n3,
  round(((media_h3 - prev_h3) / nullif(prev_h3, 0) * 100)::numeric, 1) as var_pct_h3,

  -- Intervalo 4: Separação → Conferência
  media_h4, max_h4, n4,
  round(((media_h4 - prev_h4) / nullif(prev_h4, 0) * 100)::numeric, 1) as var_pct_h4,

  -- Intervalo 5: Conferência → Expedição
  media_h5, max_h5, n5,
  round(((media_h5 - prev_h5) / nullif(prev_h5, 0) * 100)::numeric, 1) as var_pct_h5,

  -- Intervalo 6: Expedição → Entrega (Transporte)
  media_h6, max_h6, n6,
  round(((media_h6 - prev_h6) / nullif(prev_h6, 0) * 100)::numeric, 1) as var_pct_h6,

  -- Intervalo 7: Lead time total
  media_h7, max_h7, n7,
  round(((media_h7 - prev_h7) / nullif(prev_h7, 0) * 100)::numeric, 1) as var_pct_h7

from com_variacao
order by competencia desc;  -- mais recente primeiro

comment on view public.vw_evolucao_gargalos is
  'Evolução mensal dos 7 intervalos de gargalo com variação % em relação ao mês anterior. '
  'Usa EXCLUSIVAMENTE snapshots_rotina + snapshots_comprovei (sem registros_* direto). '
  'var_pct > 0 = piorou (tempo aumentou); var_pct < 0 = melhorou (tempo diminuiu). '
  'NULL na variação indica primeiro mês disponível (sem mês anterior).';

-- ----------------------------------------------------------------------------
-- GRANTs
-- ----------------------------------------------------------------------------
grant select on public.vw_sla_entregas_com_tolerancia to authenticated;
grant select on public.vw_sla_kpis_com_tolerancia     to authenticated;
grant select on public.vw_performance_rotas            to authenticated;
grant select on public.vw_evolucao_gargalos            to authenticated;

-- ============================================================================
-- Fim da migration 0012. Tabelas/views das migrations 0009–0011 não alteradas,
-- exceto ALTER TABLE prazo_rotas ADD COLUMN (aditivo, sem breaking change).
-- ============================================================================
