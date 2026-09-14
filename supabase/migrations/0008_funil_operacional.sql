-- ============================================================================
-- TNS Gestão de Entregas — Migration 0008
-- Etapa 9: Funil Operacional
-- ============================================================================
-- Cria as tabelas de dados de negócio do funil (registros_rotina e
-- registros_comprovei) e as views de cruzamento (vw_pedidos_consolidados
-- e vw_funil_kpis).
--
-- Baseado na análise real de:
--   - ROTINA8072.xls (12.039 linhas, 21 colunas, POSICAO F e M)
--   - documentSAC-20260616183501.csv (10.864 linhas, 27 colunas)
--
-- Decisões aprovadas:
--   A) POSICAO='M' e 'F' ambos importados
--   B) Campo DATA da ROTINA = data_pedido (início do funil — não COMPROVEI)
--   C) DATAGERACAOOS persistida para análises futuras
--   D) Upsert por NUMPED global (sobrescreve dados operacionais)
--
-- Segurança:
--   - RLS habilitado em ambas as tabelas
--   - Sem política DELETE para ninguém — histórico nunca é apagado
--   - Trigger de auditoria genérico (fn_registrar_auditoria) reutilizado
--   - Tabela historico_importacoes referenciada via FK (não recriada)
--
-- Como aplicar:
--   Supabase Dashboard → SQL Editor → cole este arquivo → Run
--   (ou `supabase db push`, que aplica as migrations em ordem)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabela: registros_rotina
-- Fonte: arquivo ROTINA (.xls exportado do WMS)
-- Chave primária: numped (NUMPED — único por pedido, sem duplicatas)
-- Campos descartados: CODFILIAL (constante=41), CLIENTE (redundante com codcli),
--   DESTINO (coberto por numcar), NUMTRANSWMS (ID de lote interno WMS),
--   DATAGERACAOWMS (redundante com dtwms), DATAFIMOS (~13s após datafimconferencia)
-- ----------------------------------------------------------------------------
create table if not exists public.registros_rotina (
  -- Chave principal — Decisão D: upsert global por NUMPED
  numped                text primary key,

  -- Nota Fiscal (validação cruzada com registros_comprovei.numnot_comprovei)
  numnota               text,

  -- Número da carga (agrupa pedidos por rota — ~6 pedidos/carga em média)
  numcar                text,

  -- Dados do cliente
  codcli                text,
  cgcent                text,  -- CNPJ do cliente (91.5% de match com COMPROVEI)

  -- Posição no WMS: F = Faturado | M = Em montagem (Decisão A: ambos importados)
  posicao               text not null check (posicao in ('F', 'M')),

  -- ── Datas do funil ────────────────────────────────────────────────────────
  -- Decisão B: DATA da ROTINA = data_pedido (início do funil)
  -- Confirmado na análise: não existe campo de "data de venda" no COMPROVEI
  data_pedido           timestamptz,   -- campo DATA do arquivo ROTINA
  dt_entrega            timestamptz,   -- data prevista de entrega (base para SLA)
  datafaturamento       timestamptz,   -- null para posicao='M' (não faturado ainda)
  datageracaoos         timestamptz,   -- Decisão C: persistir — média 11min antes de datainicioos
  datainicioos          timestamptz,   -- início físico da separação (94.5% preenchido)
  datafimseparacao      timestamptz,   -- fim da separação (95.7% preenchido)
  datainicioconferencia timestamptz,   -- início da conferência (94.0% preenchido)
  datafimconferencia    timestamptz,   -- fim da conferência (92.5% preenchido)
  dtwms                 timestamptz,   -- geração da carga / expedição (timestamp preciso)

  -- Rastreabilidade de importação
  importacao_id         uuid references public.historico_importacoes(id) on delete set null,
  importado_em          timestamptz not null default now()
);

comment on table public.registros_rotina is
  'Dados de negócio do arquivo ROTINA. Chave primária: NUMPED. Upsert global por numped.';
comment on column public.registros_rotina.posicao is
  'F = Faturado (todas as datas disponíveis); M = Em montagem/WMS (sem faturamento ainda).';
comment on column public.registros_rotina.data_pedido is
  'Campo DATA do arquivo ROTINA — data do pedido/venda. Início do funil operacional. Confirmado na análise: o COMPROVEI não tem campo equivalente de data de venda.';
comment on column public.registros_rotina.datageracaoos is
  'Quando o WMS gerou a Ordem de Serviço de separação. Ocorre em média 11 min antes de datainicioos. Persistido para análises futuras (Decisão C).';

-- ----------------------------------------------------------------------------
-- Tabela: registros_comprovei
-- Fonte: arquivo COMPROVEI (documentSAC CSV exportado do sistema Comprovei)
-- Chave primária: numped (campo "Pedido" do CSV — único, sem duplicatas)
-- Campos descartados: Região (99.6% = "41-STO"), Tipo (100% = "NFe"),
--   Prazo SLA (100% nulo), Status SLA (100% = "PENDENTE"),
--   Vendedor Tel. (100% = -1), Conferidos (99.9% = 0),
--   Qtd Paradas, Rota/Roteiro (múltiplos IDs concatenados em string)
-- ----------------------------------------------------------------------------
create table if not exists public.registros_comprovei (
  -- Chave principal — campo "Pedido" do CSV
  numped                text primary key,

  -- NF (campo "Documento" do CSV) — validação cruzada com registros_rotina.numnota
  -- Análise: equivalentes em 99.9% dos casos; 15 divergências detectadas
  numnot_comprovei      text,

  -- Dados do cliente
  cnpj_cliente          text,
  nome_cliente          text,
  cidade_destino        text,
  uf_destino            text,

  -- Status e ocorrências (valores reais: Entregue, Em Rota, Abortada, Devolvido...)
  status_entrega        text,
  ultima_ocorrencia     text,
  qtd_reentregas        integer not null default 0,

  -- Motorista (CPF vem como float no CSV: 92823068104.0 — tratado no service)
  motorista             text,
  cpf_motorista         text,   -- normalizado para 11 dígitos sem máscara
  placa                 text,

  -- Datas
  data_rota             timestamptz,   -- saída para entrega (≈ DTWMS da ROTINA)
  data_finalizacao      timestamptz,   -- entrega efetiva — fim do funil
  data_ult_ocorr        timestamptz,
  data_atualizacao      timestamptz,

  -- Bases logísticas
  base_origem           text,
  base_destino          text,

  -- Rastreabilidade
  importacao_id         uuid references public.historico_importacoes(id) on delete set null,
  importado_em          timestamptz not null default now()
);

comment on table public.registros_comprovei is
  'Dados de negócio do arquivo COMPROVEI (documentSAC CSV). Chave primária: Pedido (numped). Upsert global por numped.';
comment on column public.registros_comprovei.cpf_motorista is
  'CPF do motorista normalizado (11 dígitos, sem máscara). No CSV original vem como float: 92823068104.0 — convertido no funilService.js.';
comment on column public.registros_comprovei.data_finalizacao is
  'Data/hora de entrega efetiva. Fim do funil operacional. 71.4% preenchido (28.6% ainda em rota ou sem finalização).';

-- ----------------------------------------------------------------------------
-- Índices de performance
-- ----------------------------------------------------------------------------
create index if not exists idx_rot_numcar          on public.registros_rotina (numcar);
create index if not exists idx_rot_posicao         on public.registros_rotina (posicao);
create index if not exists idx_rot_data_pedido     on public.registros_rotina (data_pedido);
create index if not exists idx_rot_datafaturamento on public.registros_rotina (datafaturamento);
create index if not exists idx_rot_dtwms           on public.registros_rotina (dtwms);
create index if not exists idx_rot_importacao      on public.registros_rotina (importacao_id);
create index if not exists idx_rot_numnota         on public.registros_rotina (numnota);

create index if not exists idx_comp_status         on public.registros_comprovei (status_entrega);
create index if not exists idx_comp_data_fin       on public.registros_comprovei (data_finalizacao);
create index if not exists idx_comp_data_rota      on public.registros_comprovei (data_rota);
create index if not exists idx_comp_motorista      on public.registros_comprovei (cpf_motorista);
create index if not exists idx_comp_importacao     on public.registros_comprovei (importacao_id);
create index if not exists idx_comp_numnot         on public.registros_comprovei (numnot_comprovei);

-- ----------------------------------------------------------------------------
-- RLS
-- Leitura: qualquer usuário ativo (mesmo padrão de operacoes/motoristas)
-- Escrita: apenas administrador (mesmo padrão de historico_importacoes)
-- DELETE: nenhuma policy — "nenhum histórico poderá ser perdido"
-- ----------------------------------------------------------------------------
alter table public.registros_rotina    enable row level security;
alter table public.registros_comprovei enable row level security;

-- registros_rotina
drop policy if exists "rr_select_ativos"  on public.registros_rotina;
create policy "rr_select_ativos"
  on public.registros_rotina for select
  to authenticated using (public.fn_estou_ativo());

drop policy if exists "rr_insert_admin"  on public.registros_rotina;
create policy "rr_insert_admin"
  on public.registros_rotina for insert
  to authenticated with check (public.fn_meu_perfil() = 'administrador');

drop policy if exists "rr_update_admin"  on public.registros_rotina;
create policy "rr_update_admin"
  on public.registros_rotina for update
  to authenticated
  using (public.fn_meu_perfil() = 'administrador')
  with check (public.fn_meu_perfil() = 'administrador');

-- registros_comprovei
drop policy if exists "rc_select_ativos"  on public.registros_comprovei;
create policy "rc_select_ativos"
  on public.registros_comprovei for select
  to authenticated using (public.fn_estou_ativo());

drop policy if exists "rc_insert_admin"  on public.registros_comprovei;
create policy "rc_insert_admin"
  on public.registros_comprovei for insert
  to authenticated with check (public.fn_meu_perfil() = 'administrador');

drop policy if exists "rc_update_admin"  on public.registros_comprovei;
create policy "rc_update_admin"
  on public.registros_comprovei for update
  to authenticated
  using (public.fn_meu_perfil() = 'administrador')
  with check (public.fn_meu_perfil() = 'administrador');

-- Sem policies de DELETE — "nenhum operador pode excluir dados"

-- ----------------------------------------------------------------------------
-- Triggers de auditoria (reutiliza fn_registrar_auditoria da migration 0003)
-- ----------------------------------------------------------------------------
drop trigger if exists trg_auditoria_registros_rotina on public.registros_rotina;
create trigger trg_auditoria_registros_rotina
  after insert or update on public.registros_rotina
  for each row execute function public.fn_registrar_auditoria();

drop trigger if exists trg_auditoria_registros_comprovei on public.registros_comprovei;
create trigger trg_auditoria_registros_comprovei
  after insert or update on public.registros_comprovei
  for each row execute function public.fn_registrar_auditoria();

-- ----------------------------------------------------------------------------
-- View: vw_pedidos_consolidados
-- FULL OUTER JOIN por NUMPED — captura pedidos em apenas um dos arquivos
-- Campo etapa_atual calculado conforme regras aprovadas (8 etapas)
-- ----------------------------------------------------------------------------
create or replace view public.vw_pedidos_consolidados as
select
  -- Chave unificada
  coalesce(r.numped, c.numped)                          as numped,

  -- Notas Fiscais de ambas as fontes (para auditoria de divergência)
  r.numnota,
  c.numnot_comprovei,
  -- Divergência: NF preenchida em ambos e diferente
  (r.numnota is not null
   and c.numnot_comprovei is not null
   and r.numnota <> c.numnot_comprovei)                 as divergencia_nf,

  -- Indicador de presença em cada fonte
  case
    when r.numped is not null and c.numped is not null then 'ambos'
    when r.numped is not null                          then 'apenas_rotina'
    else                                                    'apenas_comprovei'
  end                                                    as origem,

  -- Dados da ROTINA
  r.numcar,
  r.codcli,
  r.cgcent,
  r.posicao,
  r.data_pedido,        -- Decisão B: DATA da ROTINA = início do funil
  r.dt_entrega,
  r.datafaturamento,
  r.datageracaoos,      -- Decisão C: persistido para análises futuras
  r.datainicioos,
  r.datafimseparacao,
  r.datainicioconferencia,
  r.datafimconferencia,
  r.dtwms,

  -- Dados do COMPROVEI
  c.cnpj_cliente,
  c.nome_cliente,
  c.cidade_destino,
  c.uf_destino,
  c.status_entrega,
  c.ultima_ocorrencia,
  c.qtd_reentregas,
  c.motorista,
  c.cpf_motorista,
  c.placa,
  c.data_rota,
  c.data_finalizacao,   -- fim do funil
  c.data_ult_ocorr,
  c.data_atualizacao,
  c.base_origem,
  c.base_destino,

  -- ── ETAPA_ATUAL — campo calculado ─────────────────────────────────────────
  -- Ordem de precedência: da etapa mais avançada para a mais inicial.
  -- Regras aprovadas (análise dos arquivos reais):
  --   POSICAO='M' → Aguardando Faturamento (não faturado, só no WMS)
  --   Resto segue sequência de datas preenchidas
  case
    when c.data_finalizacao       is not null
      then 'Entregue'
    when r.dtwms                  is not null and c.data_finalizacao is null
      then 'Em Transporte'
    when r.datafimconferencia     is not null and r.dtwms is null
      then 'Conferido'
    when r.datainicioconferencia  is not null and r.datafimconferencia is null
      then 'Em Conferência'
    when r.datafimseparacao       is not null and r.datainicioconferencia is null
      then 'Separado'
    when r.datainicioos           is not null and r.datafimseparacao is null
      then 'Em Separação'
    when r.datafaturamento        is not null and r.datainicioos is null
      then 'Faturado'
    when r.posicao = 'M'
      then 'Aguardando Faturamento'
    -- Pedido presente apenas no COMPROVEI (sem ROTINA correspondente)
    when c.numped is not null and r.numped is null
      then coalesce(c.status_entrega, 'Em Transporte')
    else 'Indefinido'
  end                                                    as etapa_atual,

  -- Rastreabilidade
  r.importacao_id  as rotina_importacao_id,
  c.importacao_id  as comprovei_importacao_id,
  r.importado_em   as rotina_importado_em,
  c.importado_em   as comprovei_importado_em

from public.registros_rotina r
full outer join public.registros_comprovei c
  on r.numped = c.numped;

comment on view public.vw_pedidos_consolidados is
  'Cruzamento ROTINA ↔ COMPROVEI por NUMPED (FULL OUTER JOIN). Campo etapa_atual calculado conforme regras aprovadas na Etapa 9.';

-- ----------------------------------------------------------------------------
-- View: vw_funil_kpis
-- Todos os indicadores agregados para o dashboard do funil
-- ----------------------------------------------------------------------------
create or replace view public.vw_funil_kpis as
select
  -- ── Universo ───────────────────────────────────────────────────────────────
  count(*)                                                          as total_pedidos,
  count(*) filter (where rotina_importacao_id  is not null)        as total_rotina,
  count(*) filter (where comprovei_importacao_id is not null)      as total_comprovei,

  -- ── Origem ─────────────────────────────────────────────────────────────────
  count(*) filter (where origem = 'ambos')                         as total_ambos,
  count(*) filter (where origem = 'apenas_rotina')                 as total_so_rotina,
  count(*) filter (where origem = 'apenas_comprovei')              as total_so_comprovei,

  -- ── Volume por etapa ───────────────────────────────────────────────────────
  count(*) filter (where etapa_atual = 'Aguardando Faturamento')  as total_aguardando_fat,
  count(*) filter (where etapa_atual = 'Faturado')                as total_faturado,
  count(*) filter (where etapa_atual = 'Em Separação')            as total_em_separacao,
  count(*) filter (where etapa_atual = 'Separado')                as total_separado,
  count(*) filter (where etapa_atual = 'Em Conferência')          as total_em_conferencia,
  count(*) filter (where etapa_atual = 'Conferido')               as total_conferido,
  count(*) filter (where etapa_atual = 'Em Transporte')           as total_em_transporte,
  count(*) filter (where etapa_atual = 'Entregue')                as total_entregue,

  -- ── Qualidade ──────────────────────────────────────────────────────────────
  count(*) filter (where divergencia_nf)                           as total_divergencia_nf,
  count(*) filter (where qtd_reentregas > 0)                       as total_com_reentrega,
  coalesce(sum(qtd_reentregas), 0)                                 as soma_reentregas

from public.vw_pedidos_consolidados;

comment on view public.vw_funil_kpis is
  'Indicadores agregados do Funil Operacional. Lido pela página FunilOperacional.jsx.';

-- ----------------------------------------------------------------------------
-- GRANT nas views para usuários autenticados
-- ----------------------------------------------------------------------------
grant select on public.vw_pedidos_consolidados to authenticated;
grant select on public.vw_funil_kpis           to authenticated;

-- ============================================================================
-- Fim da migration 0008. Nenhum dado fictício inserido.
-- ============================================================================
