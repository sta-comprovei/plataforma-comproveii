create table if not exists public.indicadores_comprovei(
  id uuid primary key default gen_random_uuid(),
  competencia text not null,
  importacao_id uuid references public.historico_importacoes(id) on delete set null,
  total_rotas integer, total_documentos integer,
  qualidade_pct numeric(5,2), inicio_dentro_cerca_pct numeric(5,2),
  chegada_dentro_cerca_pct numeric(5,2), ocorrencia_apontada_pct numeric(5,2),
  intervalo_compativel_pct numeric(5,2), apontamento_cerca_pct numeric(5,2),
  usuario_criacao text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint uq_indicadores_competencia unique(competencia)
);
alter table public.indicadores_comprovei enable row level security;
create policy "indicadores_comprovei_select" on public.indicadores_comprovei for select to authenticated using(public.fn_estou_ativo());
create policy "indicadores_comprovei_insert" on public.indicadores_comprovei for insert to authenticated with check(public.fn_estou_ativo());
create policy "indicadores_comprovei_update" on public.indicadores_comprovei for update to authenticated using(public.fn_estou_ativo());
grant select,insert,update on public.indicadores_comprovei to authenticated;
