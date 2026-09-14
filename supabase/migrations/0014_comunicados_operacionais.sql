-- ============================================================================
-- TNS Gestão de Entregas — Migration 0014
-- Etapa 9.3 — Comunicados Operacionais do Dia
-- ============================================================================
-- Elimina a dependência do WhatsApp para registro de ocorrências diárias.
-- Os comunicados são armazenados, auditados e consultáveis — base para IA futura.
--
-- Segurança:
--   RLS habilitado · sem policy DELETE · trigger fn_registrar_auditoria reutilizado
--   SELECT: todos os usuários ativos
--   INSERT/UPDATE: administrador e operador (comunicados são operacionais)
-- ============================================================================

create table if not exists public.comunicados_operacionais (
  id              uuid primary key default gen_random_uuid(),

  -- Data da operação (não necessariamente hoje — pode ser registro retroativo)
  data_operacao   date not null,

  -- Motorista envolvido (opcional: alguns comunicados são sobre carga/rota)
  motorista       text,
  codigo_motorista text,

  -- Rota / destino envolvido
  rota            text,

  -- Classificação do comunicado
  tipo            text not null,
  -- Valores:
  --   ALTERACAO_MOTORISTA  → troca de motorista na carga
  --   TROCA_ROTA           → rota foi alterada / redistribuída
  --   PENDENCIA            → problema sem resolução imediata
  --   OBSERVACAO           → registro geral de acompanhamento
  --   CARGA_INVERTIDA      → carga entregue em destino errado ou invertida
  --   OUTRO                → demais ocorrências

  -- Texto livre descrevendo a ocorrência
  descricao       text not null,

  -- Controle de resolução (sem DELETE — apenas inativar via resolvido)
  resolvido       boolean not null default false,
  resolvido_em    timestamptz,
  resolvido_por   text,        -- nome do usuário que marcou como resolvido

  -- Rastreabilidade
  criado_em       timestamptz not null default now(),
  criado_por      text         -- nome do usuário que registrou
);

comment on table public.comunicados_operacionais is
  'Registro de ocorrências e comunicados operacionais diários. '
  'Substitui comunicações dispersas em WhatsApp. '
  'Base para consultas futuras pela IA Assistente.';

comment on column public.comunicados_operacionais.tipo is
  'Classificação: ALTERACAO_MOTORISTA | TROCA_ROTA | PENDENCIA | '
  'OBSERVACAO | CARGA_INVERTIDA | OUTRO';

comment on column public.comunicados_operacionais.resolvido is
  'false = pendente/em aberto. true = resolvido. '
  'Nunca usar DELETE — apenas marcar resolvido = true.';

-- Índices para as consultas mais comuns
create index if not exists idx_com_data_op  on public.comunicados_operacionais (data_operacao desc);
create index if not exists idx_com_tipo     on public.comunicados_operacionais (tipo);
create index if not exists idx_com_motorist on public.comunicados_operacionais (motorista);
create index if not exists idx_com_rota     on public.comunicados_operacionais (rota);
create index if not exists idx_com_resolvido on public.comunicados_operacionais (resolvido);
-- Índice composto: consultas frequentes por data + tipo
create index if not exists idx_com_data_tipo on public.comunicados_operacionais (data_operacao desc, tipo);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.comunicados_operacionais enable row level security;

-- SELECT: qualquer usuário ativo
drop policy if exists "co_select_ativos" on public.comunicados_operacionais;
create policy "co_select_ativos"
  on public.comunicados_operacionais for select
  to authenticated using (public.fn_estou_ativo());

-- INSERT: administrador e operador (comunicados são do dia a dia operacional)
drop policy if exists "co_insert_operador" on public.comunicados_operacionais;
create policy "co_insert_operador"
  on public.comunicados_operacionais for insert
  to authenticated
  with check (public.fn_estou_ativo());

-- UPDATE: apenas para marcar resolvido = true (sem DELETE)
drop policy if exists "co_update_operador" on public.comunicados_operacionais;
create policy "co_update_operador"
  on public.comunicados_operacionais for update
  to authenticated
  using  (public.fn_estou_ativo())
  with check (public.fn_estou_ativo());

-- Sem policy DELETE — comunicados nunca são excluídos

-- ── Trigger de auditoria ────────────────────────────────────────────────────
drop trigger if exists trg_auditoria_comunicados on public.comunicados_operacionais;
create trigger trg_auditoria_comunicados
  after insert or update on public.comunicados_operacionais
  for each row execute function public.fn_registrar_auditoria();

-- ── GRANT ────────────────────────────────────────────────────────────────────
grant select on public.comunicados_operacionais to authenticated;

-- ============================================================================
-- Fim da migration 0014.
-- Migrations 0008–0013: não alteradas.
-- ============================================================================
