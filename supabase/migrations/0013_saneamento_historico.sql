-- ============================================================================
-- TNS Gestão de Entregas — Migration 0013
-- Etapa 9.2.1 — Saneamento Estrutural da Base Histórica
-- ============================================================================
-- Corrige três problemas identificados na auditoria técnica:
--
--   PROBLEMA 1 — SLA histórico reescrito retroativamente
--     prazo_rotas não tem versionamento temporal. UPDATE no prazo atual
--     altera retroativamente o cálculo de todos os meses históricos.
--     SOLUÇÃO: SCD Tipo 2 — campos vigente_desde + vigente_ate.
--     A constraint UNIQUE (rota, uf) é substituída por unique ativo:
--     apenas um registro vigente (vigente_ate IS NULL) por rota+uf.
--
--   PROBLEMA 2 — Trigger de auditoria quebrada em snapshots
--     fn_registrar_auditoria() usa new.id (hardcoded).
--     snapshots_rotina e snapshots_comprovei não têm coluna id.
--     Em PostgreSQL, new.id em tabela sem a coluna gera runtime error
--     que REVERTE a transação toda → snapshots nunca foram gravados.
--     SOLUÇÃO: ADD COLUMN id uuid DEFAULT gen_random_uuid() nas duas tabelas.
--
--   PROBLEMA 3 — JOIN com upper(trim(...)) impede uso de índice
--     vw_sla_entregas e vw_sla_entregas_com_tolerancia fazem:
--     upper(trim(cidade_destino)) = upper(trim(p.rota))
--     O índice idx_prazo_rota_nome não é usado por ter função nos dois lados.
--     SOLUÇÃO: coluna normalizada rota_norm + trigger automático + índice direto.
--     Os JOINs passam a ser: b.cidade_destino_norm = p.rota_norm
--     (sem funções — índice usado).
--
-- Não altera as migrations 0008 a 0012.
-- Não cria novas telas, KPIs ou funcionalidades.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- PROBLEMA 2 PRIMEIRO — resolver antes de 1 e 3 porque os triggers de
-- auditoria em prazo_rotas também dependem de new.id estar disponível.
-- Se snapshots_rotina e snapshots_comprovei não têm coluna id, nenhum
-- INSERT nessas tabelas funcionou até agora.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 2a. Adicionar coluna id em snapshots_rotina ───────────────────────────
alter table public.snapshots_rotina
  add column if not exists id uuid not null default gen_random_uuid();

comment on column public.snapshots_rotina.id is
  'UUID gerado automaticamente para compatibilidade com fn_registrar_auditoria(). '
  'A chave primária do negócio permanece (numped, competencia_import).';

-- ── 2b. Adicionar coluna id em snapshots_comprovei ───────────────────────
alter table public.snapshots_comprovei
  add column if not exists id uuid not null default gen_random_uuid();

comment on column public.snapshots_comprovei.id is
  'UUID gerado automaticamente para compatibilidade com fn_registrar_auditoria(). '
  'A chave primária do negócio permanece (numped, competencia_import).';

-- ── 2c. Verificar e recriar os triggers (garantir que estão ativos) ───────
-- Os triggers já existem nas migrations 0010/0011 mas podem não ter funcionado.
-- DROP + CREATE para garantir estado limpo após a adição do id.
drop trigger if exists trg_auditoria_snapshots_rotina on public.snapshots_rotina;
create trigger trg_auditoria_snapshots_rotina
  after insert or update on public.snapshots_rotina
  for each row execute function public.fn_registrar_auditoria();

drop trigger if exists trg_auditoria_snapshots_comprovei on public.snapshots_comprovei;
create trigger trg_auditoria_snapshots_comprovei
  after insert or update on public.snapshots_comprovei
  for each row execute function public.fn_registrar_auditoria();

-- ────────────────────────────────────────────────────────────────────────────
-- PROBLEMA 1 — Versionamento temporal de prazo_rotas (SCD Tipo 2)
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1a. Remover a constraint UNIQUE (rota, uf) ────────────────────────────
-- A constraint impede múltiplas linhas com o mesmo rota+uf (necessário para SCD).
-- É substituída por uma partial unique constraint que garante no máximo 1 vigente.
alter table public.prazo_rotas
  drop constraint if exists uq_prazo_rota_uf;

-- ── 1b. Adicionar campos de vigência ─────────────────────────────────────
alter table public.prazo_rotas
  add column if not exists vigente_desde timestamptz not null default now(),
  add column if not exists vigente_ate   timestamptz;

comment on column public.prazo_rotas.vigente_desde is
  'Início da vigência deste prazo. Preenchido automaticamente na criação/edição.';

comment on column public.prazo_rotas.vigente_ate is
  'Fim da vigência. NULL = prazo atual (vigente). '
  'Preenchido quando um novo prazo é cadastrado para a mesma rota+uf.';

-- ── 1c. Constraint: apenas 1 registro vigente por rota+uf ────────────────
-- PARTIAL UNIQUE: garante unicidade apenas quando vigente_ate IS NULL.
-- Múltiplas linhas históricas (vigente_ate NOT NULL) são permitidas.
create unique index if not exists uq_prazo_rota_uf_vigente
  on public.prazo_rotas (rota, uf)
  where vigente_ate is null;

comment on index public.uq_prazo_rota_uf_vigente is
  'Garante no máximo 1 prazo vigente (vigente_ate IS NULL) por rota+uf. '
  'Registros históricos (vigente_ate NOT NULL) não entram nesta constraint.';

-- ── 1d. Inicializar vigente_desde nas linhas existentes ──────────────────
-- Retroativa a created_at (campo que já existia). Sem condição de filtro
-- que dependa de now() — o default acabou de ser aplicado mas created_at
-- é o valor correto para "quando esta rota foi cadastrada".
-- Esta instrução é idempotente: reaplicar não altera linhas que já têm
-- vigente_desde = created_at.
update public.prazo_rotas
  set vigente_desde = created_at
  where created_at is not null;

-- ── 1e. Coluna normalizada rota_norm (Problema 3 integrado aqui) ─────────
-- Necessária também para o JOIN eficiente nas views de SLA.
alter table public.prazo_rotas
  add column if not exists rota_norm text;

comment on column public.prazo_rotas.rota_norm is
  'Versão normalizada de rota: upper(trim(rota)). '
  'Mantida automaticamente por trg_prazo_rotas_norm. '
  'Usada nos JOINs de SLA para evitar upper(trim(...)) em tempo de query.';

-- Populal rota_norm nas linhas existentes
update public.prazo_rotas
  set rota_norm = upper(trim(rota))
  where rota_norm is null;

-- ── 1f. Trigger: manter rota_norm atualizado automaticamente ─────────────
create or replace function public.fn_prazo_rotas_normalize()
returns trigger
language plpgsql
as $$
begin
  new.rota_norm := upper(trim(new.rota));
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.fn_prazo_rotas_normalize() is
  'Mantém rota_norm = upper(trim(rota)) e updated_at atualizados automaticamente.';

-- Substitui o antigo fn_prazo_rotas_set_updated_at (que só atualizava updated_at)
drop trigger if exists trg_prazo_rotas_updated_at  on public.prazo_rotas;
drop trigger if exists trg_prazo_rotas_normalize   on public.prazo_rotas;
create trigger trg_prazo_rotas_normalize
  before insert or update on public.prazo_rotas
  for each row execute function public.fn_prazo_rotas_normalize();

-- ── 1g. Índice em rota_norm ───────────────────────────────────────────────
create index if not exists idx_prazo_rota_norm on public.prazo_rotas (rota_norm);

-- ── 1h. Índices de vigência (para o JOIN temporal) ───────────────────────
create index if not exists idx_prazo_vigente_desde on public.prazo_rotas (vigente_desde);
create index if not exists idx_prazo_vigente_ate   on public.prazo_rotas (vigente_ate);

-- ────────────────────────────────────────────────────────────────────────────
-- PROBLEMA 3 — Coluna normalizada para o lado dos snapshots/registros
-- cidade_destino_norm em snapshots_comprovei e registros_comprovei
-- ────────────────────────────────────────────────────────────────────────────

-- Adicionar cidade_destino_norm em registros_comprovei
alter table public.registros_comprovei
  add column if not exists cidade_destino_norm text;

update public.registros_comprovei
  set cidade_destino_norm = upper(trim(cidade_destino))
  where cidade_destino_norm is null and cidade_destino is not null;

-- Adicionar cidade_destino_norm em snapshots_comprovei
alter table public.snapshots_comprovei
  add column if not exists cidade_destino_norm text;

update public.snapshots_comprovei
  set cidade_destino_norm = upper(trim(cidade_destino))
  where cidade_destino_norm is null and cidade_destino is not null;

-- Trigger: manter cidade_destino_norm em registros_comprovei
create or replace function public.fn_comprovei_normalize()
returns trigger
language plpgsql
as $$
begin
  new.cidade_destino_norm := upper(trim(new.cidade_destino));
  return new;
end;
$$;

comment on function public.fn_comprovei_normalize() is
  'Mantém cidade_destino_norm = upper(trim(cidade_destino)) automaticamente.';

drop trigger if exists trg_registros_comprovei_norm on public.registros_comprovei;
create trigger trg_registros_comprovei_norm
  before insert or update on public.registros_comprovei
  for each row execute function public.fn_comprovei_normalize();

drop trigger if exists trg_snapshots_comprovei_norm on public.snapshots_comprovei;
create trigger trg_snapshots_comprovei_norm
  before insert or update on public.snapshots_comprovei
  for each row execute function public.fn_comprovei_normalize();

-- Índices nas colunas normalizadas
create index if not exists idx_comp_cidade_norm       on public.registros_comprovei (cidade_destino_norm);
create index if not exists idx_snap_comp_cidade_norm  on public.snapshots_comprovei (cidade_destino_norm);

-- ────────────────────────────────────────────────────────────────────────────
-- RECRIAR VIEWS QUE USAM prazo_rotas — com JOIN temporal + rota_norm
-- ────────────────────────────────────────────────────────────────────────────

-- ── vw_sla_entregas (0009) ────────────────────────────────────────────────
-- Recriada com:
--   1. JOIN por p.rota_norm = upper(trim(t.cidade_destino)) — um lado normalizado,
--      o outro usa coluna calculada. O índice idx_prazo_rota_norm é usado pelo
--      lado de prazo_rotas; upper(trim(t.cidade_destino)) é avaliado 1×/linha
--      mas não impede o índice do lado prazo_rotas.
--   2. vigente_ate IS NULL — usa prazo vigente atual (correto para dados operacionais,
--      que refletem estado presente)
-- Fonte: vw_tempos_etapas (registros_* estado atual — adequado para funil operacional)
create or replace view public.vw_sla_entregas as
select
  t.numped,
  t.motorista,
  t.cidade_destino,
  t.uf_destino,
  t.status_entrega,
  t.competencia_rotina,
  t.h_transporte,

  p.prazo_dias,
  coalesce(p.prazo_horas, p.prazo_dias * 24)::numeric as prazo_horas,

  round((t.h_transporte - coalesce(p.prazo_horas, p.prazo_dias * 24))::numeric, 2)
    as diferenca_horas,
  round((t.h_transporte - coalesce(p.prazo_horas, p.prazo_dias * 24))::numeric / 24, 2)
    as diferenca_dias,

  case
    when t.h_transporte is null or p.prazo_dias is null
      then 'sem_dados'
    when t.h_transporte <= coalesce(p.prazo_horas, p.prazo_dias * 24)
      then 'dentro_prazo'
    when t.h_transporte <= coalesce(p.prazo_horas, p.prazo_dias * 24) * 1.1
      then 'dentro_prazo'
    else
      'atrasado'
  end as sla_status

from public.vw_tempos_etapas t
left join public.prazo_rotas p
  -- rota_norm é indexado; upper(trim(t.cidade_destino)) avaliado 1x/linha
  -- O planner usa idx_prazo_rota_norm para o lookup em prazo_rotas
  on  p.rota_norm = upper(trim(t.cidade_destino))
  and (t.uf_destino is null or upper(trim(t.uf_destino)) = upper(trim(p.uf)))
  and p.vigente_ate is null   -- prazo vigente atual (view operacional)
where
  t.h_transporte is not null
  and t.h_transporte > 0;

comment on view public.vw_sla_entregas is
  'SLA operacional (estado atual via vw_tempos_etapas). '
  'JOIN por p.rota_norm = upper(trim(cidade_destino)): idx_prazo_rota_norm usado em prazo_rotas. '
  'Usa prazo vigente atual (vigente_ate IS NULL). '
  'Para análise histórica por competência, use vw_sla_entregas_com_tolerancia.';

-- ── vw_sla_entregas_com_tolerancia (0012) ────────────────────────────────
-- Recriada com:
--   1. JOIN por rota_norm = cidade_destino_norm
--   2. Filtro temporal por data_rota do snapshot (CORRETO histórico)
create or replace view public.vw_sla_entregas_com_tolerancia as
with base as (
  -- Fonte primária: snapshots_comprovei (histórico real por competência)
  select
    sc.numped,
    sc.competencia_import,
    sc.motorista,
    sc.cidade_destino,
    sc.cidade_destino_norm,   -- já normalizado pelo trigger
    sc.uf_destino,
    sc.status_entrega,
    sc.data_rota,
    sc.data_finalizacao,
    case
      when sc.data_finalizacao > sc.data_rota
        then extract(epoch from (sc.data_finalizacao - sc.data_rota)) / 3600.0
    end as h_transporte
  from public.snapshots_comprovei sc
  where sc.data_rota is not null

  union all

  -- Fallback: registros_comprovei para pedidos sem snapshot
  select
    rc.numped,
    rc.competencia     as competencia_import,
    rc.motorista,
    rc.cidade_destino,
    rc.cidade_destino_norm,   -- já normalizado pelo trigger
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
    and not exists (
      select 1 from public.snapshots_comprovei sc2
      where sc2.numped = rc.numped
    )
),
com_prazo as (
  select
    b.*,
    p.id             as prazo_id,
    p.vigente_desde  as prazo_vigente_desde,
    p.vigente_ate    as prazo_vigente_ate,
    coalesce(p.prazo_horas, p.prazo_dias * 24) as prazo_horas_efetivo,
    p.tolerancia_percentual,
    p.prazo_dias,
    p.rota           as rota_cadastrada
  from base b
  left join public.prazo_rotas p
    -- JOIN por colunas normalizadas: sem funções → índice usado
    on  p.rota_norm = b.cidade_destino_norm
    and (b.uf_destino is null or upper(trim(b.uf_destino)) = upper(trim(p.uf)))
    -- ── FILTRO TEMPORAL (Problema 1 resolvido) ─────────────────────────────
    -- Localiza o prazo que estava vigente na data de saída para entrega.
    -- vigente_desde <= data_rota  → prazo já existia quando o pedido saiu
    -- vigente_ate IS NULL OR vigente_ate > data_rota → prazo ainda não encerrou
    and p.vigente_desde <= b.data_rota
    and (p.vigente_ate is null or p.vigente_ate > b.data_rota)
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
  prazo_vigente_desde,
  prazo_vigente_ate,

  round((prazo_horas_efetivo * (1 + tolerancia_percentual / 100.0))::numeric, 2)
    as limite_com_tolerancia,

  round((h_transporte - prazo_horas_efetivo)::numeric, 2)       as diferenca_horas,
  round((h_transporte - prazo_horas_efetivo)::numeric / 24, 2)  as diferenca_dias,

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
  'SLA histórico com tolerância por rota. '
  'JOIN por rota_norm (sem upper/trim — índice idx_prazo_rota_norm usado). '
  'Filtro temporal: localiza o prazo vigente na data_rota de cada pedido. '
  'Alteração futura de prazo NÃO reescrevirá histórico de meses anteriores.';

-- ────────────────────────────────────────────────────────────────────────────
-- GRANT nas views recriadas
-- ────────────────────────────────────────────────────────────────────────────
grant select on public.vw_sla_entregas                   to authenticated;
grant select on public.vw_sla_entregas_com_tolerancia    to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- NOTA SOBRE salvarPrazoRota():
-- A lógica SCD Tipo 2 (encerrar linha atual + criar nova) é implementada
-- no funilService.js (função editarPrazoRota), não no banco.
-- Não existe trigger de encerramento automático porque o banco não conhece
-- a intenção do usuário (editar vs criar nova rota com mesmo nome).
-- A responsabilidade é do service, conforme padrão do projeto.
-- ────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- Fim da migration 0013.
-- Migrations 0008–0012: não alteradas.
-- ============================================================================
