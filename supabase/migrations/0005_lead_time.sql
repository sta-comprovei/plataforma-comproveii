-- ============================================================================
-- TNS Gestão de Entregas — Migration 0005
-- Etapa 4: Lead Time
-- ============================================================================
-- Esta migration cria a tabela de metas de Lead Time (configuráveis por
-- categoria: DF, Adega, Filial) e os índices necessários para que os
-- indicadores e gráficos do módulo de Lead Time (calculados a partir de
-- `operacoes.lead_time_min`, já existente desde a migration 0001) sejam
-- performáticos mesmo com muitos registros.
--
-- O CÁLCULO de Lead Time em si não muda nesta migration: a coluna
-- `lead_time_min` já é calculada corretamente desde a Etapa 3 via
-- `fn_operacoes_before_write()`, usando subtração de timestamps do
-- Postgres (date + time → timestamp; timestamp - timestamp → interval em
-- segundos via EXTRACT(EPOCH)), que já lida nativamente com virada de
-- meia-noite e operações de múltiplos dias sem qualquer lógica condicional
-- adicional. Esta etapa consome esse valor para construir indicadores,
-- metas e visualizações.
--
-- Esta migration é incremental e não-destrutiva.
--
-- Como aplicar:
--   Supabase Dashboard → SQL Editor → cole este arquivo → Run
--   (ou `supabase db push`, que aplica as migrations em ordem)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabela: metas_lead_time
-- Uma linha por categoria (DF, Adega, Filial). Meta armazenada em MINUTOS
-- (mesma unidade de `operacoes.lead_time_min`) para comparação direta sem
-- conversões repetidas nas consultas — o frontend converte para
-- horas/dias apenas na exibição.
-- ----------------------------------------------------------------------------
create table if not exists public.metas_lead_time (
  id              uuid primary key default gen_random_uuid(),
  tipo_operacao   tipo_operacao not null unique,
  meta_minutos    integer not null check (meta_minutos > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  usuario_ultima_alteracao uuid references public.usuarios(id) on delete set null
);

comment on table public.metas_lead_time is 'Meta de Lead Time configurável por categoria de operação (DF, Adega, Filial), em minutos.';
comment on column public.metas_lead_time.meta_minutos is 'Meta em minutos. Ex.: DF=480 (8h), Adega=240 (4h), Filial=7200 (5 dias).';

-- Valores iniciais conforme exemplo do requisito da Etapa 4:
-- DF = 8 horas, Adega = 4 horas, Filial = 5 dias.
-- Usa ON CONFLICT para ser seguro em reaplicações da migration sem
-- sobrescrever metas que o usuário já tenha customizado.
insert into public.metas_lead_time (tipo_operacao, meta_minutos)
values
  ('DF', 480),
  ('Adega', 240),
  ('Filial', 7200)
on conflict (tipo_operacao) do nothing;

-- ----------------------------------------------------------------------------
-- Trigger: normaliza updated_at e usuario_ultima_alteracao a cada escrita
-- ----------------------------------------------------------------------------
create or replace function public.fn_metas_lead_time_before_write()
returns trigger
language plpgsql
as $$
begin
  new.usuario_ultima_alteracao := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_metas_lead_time_before_write on public.metas_lead_time;
create trigger trg_metas_lead_time_before_write
  before update on public.metas_lead_time
  for each row execute function public.fn_metas_lead_time_before_write();

-- ----------------------------------------------------------------------------
-- Trigger genérico de auditoria (mesmo padrão de motoristas/usuarios/operacoes)
-- Toda alteração de meta é registrada em historico_auditoria com usuário,
-- data/hora, valor anterior e valor novo (via dados_anteriores/dados_novos).
-- ----------------------------------------------------------------------------
drop trigger if exists trg_auditoria_metas_lead_time on public.metas_lead_time;
create trigger trg_auditoria_metas_lead_time
  after insert or update or delete on public.metas_lead_time
  for each row execute function public.fn_registrar_auditoria();

-- ----------------------------------------------------------------------------
-- Índices de performance para os indicadores e filtros de Lead Time
-- ----------------------------------------------------------------------------
-- Consultas de indicador SEMPRE filtram por tipo_operacao e exigem
-- lead_time_min preenchido (operação finalizada) — índice parcial composto
-- evita escanear operações ainda em andamento (lead_time_min null).
create index if not exists idx_operacoes_leadtime_tipo
  on public.operacoes (tipo_operacao, lead_time_min)
  where lead_time_min is not null;

-- Filtro por motorista + lead time (perfil do motorista)
create index if not exists idx_operacoes_leadtime_motorista
  on public.operacoes (motorista_id, lead_time_min)
  where lead_time_min is not null;

-- Filtro por período (evolução mensal, comparação entre períodos)
create index if not exists idx_operacoes_leadtime_data
  on public.operacoes (data_operacao, tipo_operacao)
  where lead_time_min is not null;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Leitura de metas: qualquer usuário ativo (administrador e operador
-- precisam ver a meta para os indicadores e alertas funcionarem).
-- Alteração de metas: somente administrador.
-- ============================================================================
alter table public.metas_lead_time enable row level security;

drop policy if exists "metas_lead_time_select_ativos" on public.metas_lead_time;
create policy "metas_lead_time_select_ativos"
  on public.metas_lead_time for select
  to authenticated
  using (public.fn_estou_ativo());

drop policy if exists "metas_lead_time_update_admin" on public.metas_lead_time;
create policy "metas_lead_time_update_admin"
  on public.metas_lead_time for update
  to authenticated
  using (public.fn_meu_perfil() = 'administrador')
  with check (public.fn_meu_perfil() = 'administrador');

-- Sem policy de INSERT/DELETE para usuários autenticados: as 3 categorias
-- são fixas (enum tipo_operacao) e já populadas acima — a operação do dia
-- a dia é sempre UPDATE da meta_minutos de uma linha existente.

-- ============================================================================
-- Fim da migration 0005. Nenhum dado fictício foi inserido — apenas os
-- valores de meta padrão explicitamente fornecidos no requisito da
-- Etapa 4 (DF=8h, Adega=4h, Filial=5 dias), que são parâmetros de
-- configuração do sistema, não registros de operação ou cadastro.
-- ============================================================================
