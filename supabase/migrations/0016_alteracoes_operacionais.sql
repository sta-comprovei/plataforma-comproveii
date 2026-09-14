-- ============================================================================
-- TNS Gestão de Entregas — Migration 0016
-- Etapa 9.5 — Alterações Operacionais do Dia
-- ============================================================================
-- Painel "Alterações do Dia" substitui avisos enviados por WhatsApp.
-- Permite criar, editar e resolver alterações. Nunca excluir.
--
-- Tipos:
--   ALTERACAO_ROTA · TROCA_MOTORISTA · INVERSAO_CARGA
--   ATRASO_OPERACIONAL · VEICULO · ENTREGA · OBSERVACAO · OUTRO
--
-- Prioridade:
--   BAIXA · MEDIA · ALTA · CRITICA
--
-- Sem DELETE · RLS · Trigger de auditoria reutilizado
-- ============================================================================

create table if not exists public.alteracoes_operacionais (
  id              uuid primary key default gen_random_uuid(),

  -- Data da alteração (pode ser diferente de criado_em — suporte a retroativo)
  data_alteracao  date not null,

  tipo            text not null,
  prioridade      text not null default 'MEDIA',

  -- Partes envolvidas
  motorista       text,
  rota            text,

  -- Conteúdo
  descricao       text not null,
  observacao      text,         -- campo livre para detalhes adicionais

  -- Controle (sem DELETE)
  resolvido       boolean not null default false,
  resolvido_em    timestamptz,
  resolvido_por   text,

  -- Rastreabilidade
  criado_em       timestamptz not null default now(),
  criado_por      text,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  text
);

comment on table public.alteracoes_operacionais is
  'Registro de alterações operacionais diárias. '
  'Substitui avisos por WhatsApp. Permite criar, editar e resolver. '
  'Nunca excluir — apenas marcar resolvido = true.';

comment on column public.alteracoes_operacionais.tipo is
  'ALTERACAO_ROTA | TROCA_MOTORISTA | INVERSAO_CARGA | '
  'ATRASO_OPERACIONAL | VEICULO | ENTREGA | OBSERVACAO | OUTRO';

comment on column public.alteracoes_operacionais.prioridade is
  'BAIXA | MEDIA | ALTA | CRITICA';

comment on column public.alteracoes_operacionais.observacao is
  'Campo livre para informações complementares, tratativas ou atualizações.';

-- Índices
create index if not exists idx_alt_data      on public.alteracoes_operacionais (data_alteracao desc);
create index if not exists idx_alt_tipo      on public.alteracoes_operacionais (tipo);
create index if not exists idx_alt_prior     on public.alteracoes_operacionais (prioridade);
create index if not exists idx_alt_resolvido on public.alteracoes_operacionais (resolvido);
create index if not exists idx_alt_motorista on public.alteracoes_operacionais (motorista);
create index if not exists idx_alt_criado_em on public.alteracoes_operacionais (criado_em desc);
-- Partial index para listagem rápida de alterações abertas
create index if not exists idx_alt_aberto    on public.alteracoes_operacionais (data_alteracao desc, prioridade)
  where resolvido = false;

-- ── Trigger para atualizado_em ───────────────────────────────────────────────
create or replace function public.fn_alteracoes_set_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists trg_alteracoes_atualizado_em on public.alteracoes_operacionais;
create trigger trg_alteracoes_atualizado_em
  before update on public.alteracoes_operacionais
  for each row execute function public.fn_alteracoes_set_atualizado_em();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.alteracoes_operacionais enable row level security;

drop policy if exists "alt_select" on public.alteracoes_operacionais;
create policy "alt_select"
  on public.alteracoes_operacionais for select
  to authenticated using (public.fn_estou_ativo());

drop policy if exists "alt_insert" on public.alteracoes_operacionais;
create policy "alt_insert"
  on public.alteracoes_operacionais for insert
  to authenticated with check (public.fn_estou_ativo());

drop policy if exists "alt_update" on public.alteracoes_operacionais;
create policy "alt_update"
  on public.alteracoes_operacionais for update
  to authenticated
  using  (public.fn_estou_ativo())
  with check (public.fn_estou_ativo());

-- Sem policy DELETE

-- ── Trigger de auditoria ────────────────────────────────────────────────────
drop trigger if exists trg_auditoria_alteracoes on public.alteracoes_operacionais;
create trigger trg_auditoria_alteracoes
  after insert or update on public.alteracoes_operacionais
  for each row execute function public.fn_registrar_auditoria();

-- ── GRANT ────────────────────────────────────────────────────────────────────
grant select on public.alteracoes_operacionais to authenticated;

-- ============================================================================
-- Fim da migration 0016.
-- ============================================================================
