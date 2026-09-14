-- ============================================================================
-- TNS Gestão de Entregas — Migration 0017
-- Monitoramento de Status COMPROVEI por Motorista
-- ============================================================================
-- Tabela de último status conhecido de cada motorista no COMPROVEI.
-- Atualizada via upsert a cada importação de arquivo COMPROVEI.
-- PK: cpf_motorista (11 dígitos, sem máscara — mesmo padrão de registros_comprovei)
--
-- Propósito: alimentar o painel de Pendências com dados por MOTORISTA
-- (não por pedido), permitindo as regras:
--   - Sem atualização há X horas
--   - Presente no COMPROVEI mas ausente na Operação do Dia
--   - Ausente no COMPROVEI mas presente na Operação do Dia
--   - Divergência de rota entre Op. do Dia e COMPROVEI
-- ============================================================================

create table if not exists public.comprovei_status_motorista (
  cpf_motorista   text primary key,     -- 11 dígitos sem máscara (mesmo padrão)
  nome_motorista  text not null,
  placa           text,
  rota_atual      text,                 -- cidade_destino do último pedido
  status_entrega  text,                 -- status do último pedido processado
  qtd_pedidos_hoje integer default 0,   -- pedidos com data_rota = hoje
  qtd_em_rota     integer default 0,    -- pedidos com status ≠ Entregue/Finalizado
  qtd_entregues   integer default 0,    -- pedidos com status Entregue/Finalizado
  ultima_atualizacao timestamptz,       -- data_atualizacao do arquivo COMPROVEI
  importado_em    timestamptz not null default now(), -- quando o registro foi gravado
  importacao_id   uuid references public.historico_importacoes(id) on delete set null
);

comment on table public.comprovei_status_motorista is
  'Último status conhecido de cada motorista no COMPROVEI. '
  'Atualizado via upsert a cada upload de arquivo de atualização. '
  'Usado pelo painel de Pendências para cruzar com Operação do Dia.';

comment on column public.comprovei_status_motorista.ultima_atualizacao is
  'Campo "Data Atualização" do arquivo COMPROVEI — quando o status foi modificado.';

comment on column public.comprovei_status_motorista.importado_em is
  'Momento em que este registro foi gravado/atualizado na plataforma.';

-- Índice para consultas por nome (buscas parciais)
create index if not exists idx_csm_nome
  on public.comprovei_status_motorista (nome_motorista);

-- Índice para filtrar por data de importação (recente)
create index if not exists idx_csm_importado
  on public.comprovei_status_motorista (importado_em desc);

-- Índice para filtrar motoristas sem atualização recente
create index if not exists idx_csm_ultima_atual
  on public.comprovei_status_motorista (ultima_atualizacao desc nulls last);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.comprovei_status_motorista enable row level security;

drop policy if exists "csm_select" on public.comprovei_status_motorista;
create policy "csm_select"
  on public.comprovei_status_motorista for select
  to authenticated using (public.fn_estou_ativo());

drop policy if exists "csm_insert" on public.comprovei_status_motorista;
create policy "csm_insert"
  on public.comprovei_status_motorista for insert
  to authenticated with check (public.fn_estou_ativo());

drop policy if exists "csm_update" on public.comprovei_status_motorista;
create policy "csm_update"
  on public.comprovei_status_motorista for update
  to authenticated
  using  (public.fn_estou_ativo())
  with check (public.fn_estou_ativo());

-- Sem DELETE — histórico preservado

-- ── GRANT ────────────────────────────────────────────────────────────────────
grant select on public.comprovei_status_motorista to authenticated;

-- ============================================================================
-- Fim da migration 0017.
-- ============================================================================
