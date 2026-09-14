-- ============================================================================
-- TNS Gestão de Entregas — Migration 0015
-- Etapa 9.4 — Central de Alertas Operacionais
-- ============================================================================
-- Tabela para armazenar alertas gerados automaticamente ou manualmente.
-- Alimentada pelo alertasService.js (geração automática por regras).
-- Base para dashboards e IA futura.
--
-- Tipos de alerta:
--   SLA_ATRASADO          → entrega acima do prazo configurado
--   TRANSPORTE_ACIMA_PRAZO → tempo em transporte excedeu limite
--   SEPARACAO_ACIMA_PRAZO  → tempo de separação excedeu limiar
--   CONFERENCIA_ACIMA_PRAZO→ tempo de conferência excedeu limiar
--   DIVERGENCIA           → divergência de NF entre ROTINA e COMPROVEI
--   COMUNICADO_PENDENTE   → comunicado operacional sem resolução
--   OUTRO                 → demais situações
--
-- Severidade:
--   BAIXA · MEDIA · ALTA · CRITICA
--
-- Sem DELETE · RLS habilitado · trigger de auditoria reutilizado
-- ============================================================================

create table if not exists public.alertas_operacionais (
  id           uuid primary key default gen_random_uuid(),

  tipo         text not null,       -- ver enum de tipos acima
  severidade   text not null,       -- BAIXA | MEDIA | ALTA | CRITICA

  -- Referências (todas opcionais — depende do tipo de alerta)
  numped       text,                -- pedido envolvido
  motorista    text,                -- motorista envolvido
  rota         text,                -- rota/destino

  -- Descrição legível do alerta
  descricao    text not null,

  -- Dados técnicos do alerta (valor que gerou o disparo)
  valor_encontrado  numeric(10,2),  -- ex: horas de atraso
  limiar_configurado numeric(10,2), -- ex: prazo em horas

  -- Controle de resolução (sem DELETE)
  resolvido    boolean not null default false,
  resolvido_em timestamptz,
  resolvido_por text,

  -- Rastreabilidade
  criado_em    timestamptz not null default now(),
  criado_por   text default 'sistema'  -- 'sistema' = gerado automaticamente
);

comment on table public.alertas_operacionais is
  'Central de Alertas Operacionais. '
  'Alertas gerados automaticamente por regras (alertasService.js) '
  'ou registrados manualmente. Base para IA futura. '
  'Nunca usar DELETE — apenas marcar resolvido = true.';

comment on column public.alertas_operacionais.valor_encontrado is
  'Valor numérico que disparou o alerta. Ex: 72.5 (horas de transporte).';

comment on column public.alertas_operacionais.limiar_configurado is
  'Limiar que foi ultrapassado. Ex: 48.0 (prazo da rota em horas).';

comment on column public.alertas_operacionais.criado_por is
  '"sistema" = gerado automaticamente pela função de geração. '
  'Nome do usuário = criado manualmente.';

-- Índices
create index if not exists idx_alerta_tipo        on public.alertas_operacionais (tipo);
create index if not exists idx_alerta_severidade  on public.alertas_operacionais (severidade);
create index if not exists idx_alerta_resolvido   on public.alertas_operacionais (resolvido);
create index if not exists idx_alerta_numped      on public.alertas_operacionais (numped);
create index if not exists idx_alerta_motorista   on public.alertas_operacionais (motorista);
create index if not exists idx_alerta_criado_em   on public.alertas_operacionais (criado_em desc);
-- Índice composto para o filtro mais comum: abertos por severidade
create index if not exists idx_alerta_aberto_sev  on public.alertas_operacionais (resolvido, severidade)
  where resolvido = false;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.alertas_operacionais enable row level security;

-- SELECT: todos os usuários ativos
drop policy if exists "ao_select_ativos" on public.alertas_operacionais;
create policy "ao_select_ativos"
  on public.alertas_operacionais for select
  to authenticated using (public.fn_estou_ativo());

-- INSERT: usuários ativos (geração automática e manual)
drop policy if exists "ao_insert_ativos" on public.alertas_operacionais;
create policy "ao_insert_ativos"
  on public.alertas_operacionais for insert
  to authenticated with check (public.fn_estou_ativo());

-- UPDATE: usuários ativos (marcar resolvido)
drop policy if exists "ao_update_ativos" on public.alertas_operacionais;
create policy "ao_update_ativos"
  on public.alertas_operacionais for update
  to authenticated
  using  (public.fn_estou_ativo())
  with check (public.fn_estou_ativo());

-- Sem policy DELETE — alertas nunca são excluídos

-- ── Trigger de auditoria ────────────────────────────────────────────────────
drop trigger if exists trg_auditoria_alertas on public.alertas_operacionais;
create trigger trg_auditoria_alertas
  after insert or update on public.alertas_operacionais
  for each row execute function public.fn_registrar_auditoria();

-- ── GRANT ────────────────────────────────────────────────────────────────────
grant select on public.alertas_operacionais to authenticated;

-- ============================================================================
-- Fim da migration 0015.
-- ============================================================================
