-- ============================================================================
-- 0019_historico_desempenho_motoristas.sql
-- Histórico permanente de desempenho de motoristas extraído do relatório
-- "Gerencial motoristas" do Comprovei (arquivo .xls).
--
-- Colunas reais confirmadas por análise do arquivo real:
--   MOTORISTA, ROTAS, DOCUMENTOS, QUALIDADE,
--   INÍCIO DENTRO DA CERCA, CHEGADA DENTRO DA CERCA,
--   OCORRÊNCIA APONTADA, INTERVALO COMPATÍVEL, APONTAMENTO NA CERCA
--
-- Formato dos valores numéricos: "N(P%)" → qtd absoluta e percentual.
-- Ex: "60(100%)" → rotas_qtd=60, rotas_pct=100
-- QUALIDADE vem como percentual puro: "97%" → qualidade_pct=97.00
--
-- Não há CPF/código no arquivo. Chave de identidade = nome_normalizado.
-- INSERT puro (sem upsert): cada importação gera novo snapshot histórico.
-- ============================================================================

create table if not exists public.historico_desempenho_motoristas (
  id                    uuid primary key default gen_random_uuid(),

  -- Identificação (nome é a única chave disponível no arquivo)
  nome_motorista        text not null,
  nome_normalizado      text not null,   -- lowercase sem acentos para agrupamento

  -- Referência temporal
  competencia           text not null,   -- YYYY-MM (ex: '2026-07')
  data_referencia       date not null,   -- primeiro dia do mês: 2026-07-01

  -- QUALIDADE — percentual puro ("97%" → 97.00)
  qualidade_pct         numeric(5,2),

  -- ROTAS — "N(P%)"
  rotas_qtd             integer,
  rotas_pct             numeric(5,2),

  -- DOCUMENTOS — "N(P%)"
  documentos_qtd        integer,
  documentos_pct        numeric(5,2),

  -- INÍCIO DENTRO DA CERCA — "N(P%)"
  inicio_cerca_qtd      integer,
  inicio_cerca_pct      numeric(5,2),

  -- CHEGADA DENTRO DA CERCA — "N(P%)"
  chegada_cerca_qtd     integer,
  chegada_cerca_pct     numeric(5,2),

  -- OCORRÊNCIA APONTADA — "N(P%)"
  ocorrencia_qtd        integer,
  ocorrencia_pct        numeric(5,2),

  -- INTERVALO COMPATÍVEL — "N(P%)"
  intervalo_qtd         integer,
  intervalo_pct         numeric(5,2),

  -- APONTAMENTO NA CERCA — "N(P%)"
  apontamento_qtd       integer,
  apontamento_pct       numeric(5,2),

  -- Rastreabilidade
  importacao_id         uuid references public.historico_importacoes(id) on delete set null,
  importado_em          timestamptz not null default now()
);

comment on table public.historico_desempenho_motoristas is
  'Histórico permanente de KPIs de desempenho por motorista, extraído do '
  'relatório Gerencial motoristas do Comprovei (.xls). '
  'INSERT puro — nunca sobrescreve. Cada importação gera novos registros.';

create index if not exists idx_hdm_nome_competencia
  on public.historico_desempenho_motoristas (nome_normalizado, competencia);
create index if not exists idx_hdm_competencia
  on public.historico_desempenho_motoristas (competencia desc);
create index if not exists idx_hdm_importado_em
  on public.historico_desempenho_motoristas (importado_em desc);

alter table public.historico_desempenho_motoristas enable row level security;

drop policy if exists "hdm_select" on public.historico_desempenho_motoristas;
create policy "hdm_select"
  on public.historico_desempenho_motoristas for select
  to authenticated using (public.fn_estou_ativo());

drop policy if exists "hdm_insert" on public.historico_desempenho_motoristas;
create policy "hdm_insert"
  on public.historico_desempenho_motoristas for insert
  to authenticated with check (public.fn_estou_ativo());

grant select, insert on public.historico_desempenho_motoristas to authenticated;

-- ── VIEWS ────────────────────────────────────────────────────────────────────

create or replace view public.vw_evolucao_mensal_empresa as
select
  competencia,
  data_referencia,
  round(avg(qualidade_pct)::numeric, 2)     as media_qualidade,
  round(avg(rotas_qtd)::numeric, 1)          as media_rotas,
  round(avg(documentos_qtd)::numeric, 1)     as media_documentos,
  round(avg(inicio_cerca_pct)::numeric, 2)   as media_inicio_cerca_pct,
  round(avg(chegada_cerca_pct)::numeric, 2)  as media_chegada_cerca_pct,
  round(avg(ocorrencia_pct)::numeric, 2)     as media_ocorrencia_pct,
  round(avg(intervalo_pct)::numeric, 2)      as media_intervalo_pct,
  round(avg(apontamento_pct)::numeric, 2)    as media_apontamento_pct,
  count(distinct nome_normalizado)           as total_motoristas,
  max(importado_em)                          as ultima_importacao
from public.historico_desempenho_motoristas
group by competencia, data_referencia
order by competencia desc;

create or replace view public.vw_ultimo_snapshot_motorista as
select distinct on (nome_normalizado, competencia)
  nome_motorista, nome_normalizado, competencia, data_referencia,
  qualidade_pct, rotas_qtd, rotas_pct, documentos_qtd, documentos_pct,
  inicio_cerca_qtd, inicio_cerca_pct, chegada_cerca_qtd, chegada_cerca_pct,
  ocorrencia_qtd, ocorrencia_pct, intervalo_qtd, intervalo_pct,
  apontamento_qtd, apontamento_pct, importado_em
from public.historico_desempenho_motoristas
order by nome_normalizado, competencia, importado_em desc;

create or replace view public.vw_ranking_desempenho as
with ult as (select max(competencia) as c from public.historico_desempenho_motoristas),
  atual as (
    select s.* from public.vw_ultimo_snapshot_motorista s join ult on s.competencia = ult.c
  ),
  anterior as (
    select s.* from public.vw_ultimo_snapshot_motorista s join ult on true
    where s.competencia = to_char((to_date(ult.c,'YYYY-MM') - interval '1 month'),'YYYY-MM')
  )
select
  a.nome_motorista, a.nome_normalizado, a.competencia,
  a.qualidade_pct, a.rotas_qtd, a.documentos_qtd,
  a.inicio_cerca_pct, a.chegada_cerca_pct, a.ocorrencia_pct,
  a.intervalo_pct, a.apontamento_pct,
  p.qualidade_pct as qualidade_pct_anterior,
  round((a.qualidade_pct - coalesce(p.qualidade_pct, a.qualidade_pct))::numeric, 2) as variacao_qualidade
from atual a
left join anterior p using (nome_normalizado)
order by a.qualidade_pct desc nulls last;
