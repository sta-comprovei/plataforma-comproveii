-- ============================================================================
-- TNS Gestão de Entregas — Migration 0007
-- Etapa 8: Importação de Arquivos
-- ============================================================================
-- Esta migration cria a INFRAESTRUTURA de importação de arquivos —
-- conforme o requisito explícito da Etapa 8, NÃO implementa o
-- processamento/persistência dos dados de negócio contidos nos arquivos
-- (Funil Operacional, integrações Comprovei/Rotina): isso é trabalho de
-- uma etapa futura. O que esta migration cria é o registro de QUE uma
-- importação aconteceu, quem a realizou, o resultado e os metadados do
-- arquivo — não o conteúdo linha-a-linha importado.
--
-- Duas tabelas, com responsabilidades distintas:
--
--   historico_importacoes: log de EVENTOS — uma linha por tentativa de
--     importação (sucesso, erro de validação, ou bloqueada por
--     duplicata). É o que a tela "Importações" exibe no histórico.
--     Nunca apagado automaticamente.
--
--   arquivos_importados_controle: índice de DEDUPLICAÇÃO — uma linha por
--     arquivo cujo CONTEÚDO (hash SHA-256, não o nome) já foi importado
--     com sucesso ao menos uma vez. Existe para permitir checar
--     rapidamente "este arquivo específico já foi importado antes?"
--     sem escanear todo o histórico, e para impedir reimportação
--     silenciosa do mesmo conteúdo sem confirmação explícita do usuário.
--
-- Esta migration é incremental e não-destrutiva.
--
-- Como aplicar:
--   Supabase Dashboard → SQL Editor → cole este arquivo → Run
--   (ou `supabase db push`, que aplica as migrations em ordem)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tipos enumerados
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'origem_importacao') then
    -- As 3 origens já citadas no requisito como integrações futuras.
    -- 'outro' cobre qualquer upload genérico não mapeado a uma origem
    -- conhecida (a infraestrutura de upload não exige que o arquivo
    -- já pertença a uma integração específica para ser registrado).
    create type origem_importacao as enum ('comprovei', 'rotina', 'funil_operacional', 'outro');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_importacao') then
    create type status_importacao as enum (
      'processando',
      'concluido',
      'concluido_com_avisos',
      'erro',
      'duplicado_bloqueado'
    );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Tabela: arquivos_importados_controle
-- Índice de deduplicação por conteúdo (hash), não por nome de arquivo —
-- o mesmo conteúdo enviado com nomes diferentes é reconhecido como o
-- mesmo arquivo; nomes iguais com conteúdo diferente não conflitam.
-- ----------------------------------------------------------------------------
create table if not exists public.arquivos_importados_controle (
  id                uuid primary key default gen_random_uuid(),
  hash_conteudo     text not null unique,
  nome_arquivo      text not null,
  tamanho_bytes     bigint not null check (tamanho_bytes >= 0),
  origem            origem_importacao not null default 'outro',
  primeira_importacao_id uuid, -- referencia historico_importacoes; FK adicionada após a criação dessa tabela, abaixo
  total_registros   integer not null default 0,
  created_at        timestamptz not null default now()
);

comment on table public.arquivos_importados_controle is 'Índice de deduplicação por conteúdo (hash SHA-256) — um arquivo já importado com sucesso não pode ser reimportado silenciosamente.';
comment on column public.arquivos_importados_controle.hash_conteudo is 'SHA-256 do conteúdo do arquivo (não do nome) — calculado no navegador via Web Crypto API.';
comment on column public.arquivos_importados_controle.primeira_importacao_id is 'Aponta para o registro em historico_importacoes da primeira vez que este conteúdo foi importado com sucesso.';

-- ----------------------------------------------------------------------------
-- Tabela: historico_importacoes
-- Log permanente de toda tentativa de importação — sucesso, erro de
-- validação, ou bloqueio por duplicata. Nunca apagado automaticamente
-- ("nenhum histórico poderá ser perdido").
-- ----------------------------------------------------------------------------
create table if not exists public.historico_importacoes (
  id                  uuid primary key default gen_random_uuid(),

  nome_arquivo        text not null,
  tamanho_bytes       bigint not null check (tamanho_bytes >= 0),
  tipo_arquivo        text not null, -- extensão normalizada: 'csv' ou 'xlsx'
  hash_conteudo       text,          -- nulo se a validação falhou antes do hash ser calculável (ex.: arquivo vazio)
  origem              origem_importacao not null default 'outro',

  status              status_importacao not null default 'processando',
  total_registros     integer not null default 0,
  registros_validos   integer not null default 0,
  registros_invalidos integer not null default 0,
  registros_duplicados_no_arquivo integer not null default 0,

  mensagem_resultado  text,   -- resumo amigável (sucesso ou motivo do erro)
  detalhes_erros      jsonb,  -- lista estruturada de erros/avisos encontrados na validação

  arquivo_controle_id uuid references public.arquivos_importados_controle(id) on delete set null,

  usuario_id          uuid references public.usuarios(id) on delete set null,
  nome_usuario        text not null, -- congelado no momento da importação, mesmo padrão de historico_auditoria

  created_at          timestamptz not null default now()
);

comment on table public.historico_importacoes is 'Log permanente de toda tentativa de importação de arquivo (Comprovei, Rotina ou genérica). Nunca apagado automaticamente.';
comment on column public.historico_importacoes.status is 'processando (upload em andamento) | concluido | concluido_com_avisos (importado mas com registros inválidos/duplicados descartados) | erro (validação falhou, nada foi processado) | duplicado_bloqueado (mesmo conteúdo já importado antes, requer confirmação).';
comment on column public.historico_importacoes.detalhes_erros is 'Array JSON de objetos {linha, campo, mensagem} — detalhamento amigável dos problemas encontrados na validação.';
comment on column public.historico_importacoes.nome_usuario is 'Nome do usuário responsável, congelado no momento da importação — não muda retroativamente se o usuário for renomeado depois.';

alter table public.arquivos_importados_controle
  drop constraint if exists fk_arquivos_controle_primeira_importacao;
alter table public.arquivos_importados_controle
  add constraint fk_arquivos_controle_primeira_importacao
  foreign key (primeira_importacao_id) references public.historico_importacoes(id) on delete set null;

-- ----------------------------------------------------------------------------
-- Trigger: preenche usuario_id/nome_usuario automaticamente a partir do
-- usuário autenticado — mesmo padrão de segurança já usado em
-- operacoes.usuario_criacao (Etapa 3): o frontend não envia esses
-- valores manualmente, evitando que um usuário se passe por outro.
-- ----------------------------------------------------------------------------
create or replace function public.fn_historico_importacoes_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.usuario_id := auth.uid();
  new.nome_usuario := coalesce((select nome from public.usuarios where id = auth.uid()), 'Sistema');
  return new;
end;
$$;

drop trigger if exists trg_historico_importacoes_before_insert on public.historico_importacoes;
create trigger trg_historico_importacoes_before_insert
  before insert on public.historico_importacoes
  for each row execute function public.fn_historico_importacoes_before_insert();

-- ----------------------------------------------------------------------------
-- Trigger genérico de auditoria (mesmo padrão de motoristas/usuarios/
-- operacoes/metas_lead_time) — toda alteração de status de uma
-- importação (ex.: processando -> concluído) fica registrada em
-- historico_auditoria, além do próprio log em historico_importacoes.
-- ----------------------------------------------------------------------------
drop trigger if exists trg_auditoria_historico_importacoes on public.historico_importacoes;
create trigger trg_auditoria_historico_importacoes
  after insert or update or delete on public.historico_importacoes
  for each row execute function public.fn_registrar_auditoria();

-- ----------------------------------------------------------------------------
-- Índices de performance
-- ----------------------------------------------------------------------------
create index if not exists idx_importacoes_created_at on public.historico_importacoes (created_at desc);
create index if not exists idx_importacoes_usuario on public.historico_importacoes (usuario_id);
create index if not exists idx_importacoes_status on public.historico_importacoes (status);
create index if not exists idx_importacoes_origem on public.historico_importacoes (origem);
create index if not exists idx_arquivos_controle_hash on public.arquivos_importados_controle (hash_conteudo);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- ---- historico_importacoes ----
alter table public.historico_importacoes enable row level security;

-- Qualquer usuário ativo pode VISUALIZAR o histórico — administrador
-- tem acesso total, operador "apenas visualização do histórico"
-- (conforme requisito da Etapa 8).
drop policy if exists "importacoes_select_ativos" on public.historico_importacoes;
create policy "importacoes_select_ativos"
  on public.historico_importacoes for select
  to authenticated
  using (public.fn_estou_ativo());

-- Apenas administrador pode INICIAR uma importação (criar o registro).
-- "Administrador: acesso total. Operador: apenas visualização do
-- histórico" — operador não tem permissão de upload nesta etapa.
drop policy if exists "importacoes_insert_admin" on public.historico_importacoes;
create policy "importacoes_insert_admin"
  on public.historico_importacoes for insert
  to authenticated
  with check (public.fn_meu_perfil() = 'administrador');

-- Apenas administrador pode ATUALIZAR um registro de importação (ex.:
-- transição de status processando -> concluído, preenchida pelo próprio
-- fluxo de upload do admin). Nota: esta policy não restringe quais
-- transições de status são válidas (ex.: não impede tecnicamente um
-- admin de editar um registro já finalizado dias depois via chamada
-- direta à API) — mesmo padrão já aceito em `operacoes` (Etapa 3), onde
-- a rastreabilidade vem do trigger de auditoria genérico (já anexado
-- abaixo a esta tabela), não de travas adicionais de RLS por estado.
-- Qualquer UPDATE aqui fica registrado em historico_auditoria com
-- dados_anteriores/dados_novos, então mesmo uma edição posterior nunca
-- é silenciosa.
drop policy if exists "importacoes_update_admin" on public.historico_importacoes;
create policy "importacoes_update_admin"
  on public.historico_importacoes for update
  to authenticated
  using (public.fn_meu_perfil() = 'administrador')
  with check (public.fn_meu_perfil() = 'administrador');

-- Nenhuma policy de DELETE é criada — nem para administrador, nem para
-- operador. "Operador não pode excluir histórico" é uma restrição
-- explícita do requisito; e como "nenhum histórico poderá ser perdido"
-- é uma regra geral da própria importação, a ausência de qualquer
-- policy de delete também impede o administrador de excluir pela API —
-- consistente com o mesmo padrão já adotado em historico_auditoria
-- (Etapa 2), que também nunca permite exclusão via API.

-- ---- arquivos_importados_controle ----
alter table public.arquivos_importados_controle enable row level security;

-- Qualquer usuário ativo pode consultar o índice de deduplicação — é
-- necessário para a tela de upload avisar "este arquivo já foi
-- importado" antes mesmo de tentar enviar.
drop policy if exists "arquivos_controle_select_ativos" on public.arquivos_importados_controle;
create policy "arquivos_controle_select_ativos"
  on public.arquivos_importados_controle for select
  to authenticated
  using (public.fn_estou_ativo());

-- Apenas administrador pode registrar um novo arquivo no índice de
-- controle (acontece automaticamente ao concluir uma importação com
-- sucesso, nunca uma ação manual separada).
drop policy if exists "arquivos_controle_insert_admin" on public.arquivos_importados_controle;
create policy "arquivos_controle_insert_admin"
  on public.arquivos_importados_controle for insert
  to authenticated
  with check (public.fn_meu_perfil() = 'administrador');

-- Sem policy de UPDATE/DELETE para ninguém — o índice de deduplicação é
-- write-once: uma vez que um hash de conteúdo é registrado como
-- importado, esse registro não é alterado nem removido por nenhum
-- caminho da API, garantindo que a checagem de duplicata nunca possa
-- ser burlada apagando a evidência de uma importação anterior.

-- ============================================================================
-- Fim da migration 0007. Nenhum dado fictício foi inserido — as tabelas
-- começam vazias, populadas apenas por importações reais realizadas
-- pelos usuários através da tela "Importações".
-- ============================================================================
