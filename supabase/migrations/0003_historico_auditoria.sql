-- ============================================================================
-- TNS Gestão de Entregas — Migration 0003
-- Sistema de Auditoria e Histórico de Alterações
-- ============================================================================
-- Esta migration cria uma tabela central de auditoria e uma arquitetura de
-- trigger GENÉRICA E REUTILIZÁVEL: qualquer tabela do sistema pode passar a
-- ser auditada anexando um único trigger AFTER INSERT/UPDATE/DELETE que
-- aponta para a mesma função `fn_registrar_auditoria()`. Isso garante que
-- nenhuma alteração escapa do registro — a auditoria acontece no banco,
-- não depende do frontend "lembrar" de logar cada ação — e que módulos
-- futuros (Operação do Dia, Histórico, Lead Time, Configurações, etc.)
-- sigam exatamente o mesmo padrão sem duplicar lógica.
--
-- Esta migration é incremental e não-destrutiva: não remove nada das
-- migrations 0001/0002. Apenas adiciona a tabela de auditoria e anexa
-- triggers AFTER em `motoristas` e `usuarios`.
--
-- Como aplicar:
--   Supabase Dashboard → SQL Editor → cole este arquivo → Run
--   (ou `supabase db push`, que aplica as migrations em ordem)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tipo enumerado: tipo de ação auditada
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_acao_auditoria') then
    create type tipo_acao_auditoria as enum (
      'criacao',
      'edicao',
      'inativacao',
      'reativacao',
      'exclusao_logica',
      'exclusao_permanente'
    );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Tabela: historico_auditoria
-- Registro central e permanente de toda alteração relevante no sistema.
-- Nunca é apagada automaticamente — nem mesmo quando o registro original
-- é excluído (dados_anteriores/dados_novos preservam o conteúdo em JSON,
-- independente do ciclo de vida da linha original).
-- ----------------------------------------------------------------------------
create table if not exists public.historico_auditoria (
  id                uuid primary key default gen_random_uuid(),

  tabela_afetada    text not null,
  registro_id       uuid not null,

  tipo_acao         tipo_acao_auditoria not null,

  usuario_id        uuid references public.usuarios(id) on delete set null,
  -- nome_usuario é congelado no momento da ação (não é uma FK derivada),
  -- propositalmente: se o usuário for renomeado ou removido depois, o
  -- registro histórico continua mostrando o nome de quem realmente agiu
  -- naquele momento, preservando a fidelidade da auditoria.
  nome_usuario      text not null,

  data_hora         timestamptz not null default now(),

  dados_anteriores  jsonb,
  dados_novos       jsonb,

  observacao        text
);

comment on table public.historico_auditoria is
  'Registro permanente e centralizado de auditoria. Nunca apagado automaticamente. Alimentado por triggers genéricos AFTER INSERT/UPDATE/DELETE em tabelas auditadas.';
comment on column public.historico_auditoria.tabela_afetada is 'Nome da tabela onde a alteração ocorreu (ex: motoristas, usuarios).';
comment on column public.historico_auditoria.registro_id is 'id da linha afetada na tabela_afetada (preservado mesmo após exclusão).';
comment on column public.historico_auditoria.nome_usuario is 'Nome do usuário congelado no momento da ação — não muda retroativamente se o usuário for renomeado depois.';
comment on column public.historico_auditoria.dados_anteriores is 'Snapshot da linha ANTES da alteração (NULL em criação).';
comment on column public.historico_auditoria.dados_novos is 'Snapshot da linha DEPOIS da alteração (NULL em exclusão permanente).';

-- ----------------------------------------------------------------------------
-- Índices de performance
-- Cobrem exatamente os filtros pedidos: data_hora, usuario_id,
-- tabela_afetada, tipo_acao — mais um índice composto para a consulta mais
-- comum da tela de Histórico (ordenar por data, descendente) e um índice
-- para "ver tudo sobre um registro específico".
-- ----------------------------------------------------------------------------
create index if not exists idx_auditoria_data_hora
  on public.historico_auditoria (data_hora desc);

create index if not exists idx_auditoria_usuario
  on public.historico_auditoria (usuario_id);

create index if not exists idx_auditoria_tabela
  on public.historico_auditoria (tabela_afetada);

create index if not exists idx_auditoria_tipo_acao
  on public.historico_auditoria (tipo_acao);

create index if not exists idx_auditoria_registro
  on public.historico_auditoria (tabela_afetada, registro_id);

-- Índice composto para o caso de uso mais frequente da tela de Histórico:
-- filtrar por tabela + ordenar por data recente.
create index if not exists idx_auditoria_tabela_data
  on public.historico_auditoria (tabela_afetada, data_hora desc);

-- ----------------------------------------------------------------------------
-- Função utilitária: nome do usuário autenticado atual
-- (com fallback para "Sistema" quando a ação não tem usuário associado,
-- por exemplo seeds administrativos rodados diretamente no SQL Editor)
-- ----------------------------------------------------------------------------
create or replace function public.fn_nome_usuario_atual()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select nome from public.usuarios where id = auth.uid()),
    'Sistema'
  );
$$;

-- ----------------------------------------------------------------------------
-- Função GENÉRICA de auditoria — anexável a qualquer tabela.
--
-- Detecta automaticamente o tipo de ação:
--   - INSERT                                          -> 'criacao'
--   - DELETE                                          -> 'exclusao_permanente'
--   - UPDATE com coluna 'ativo' false->true            -> 'reativacao'
--   - UPDATE com coluna 'ativo' true->false            -> 'inativacao'
--   - UPDATE qualquer outro caso                       -> 'edicao'
--
-- A detecção de inativação/reativação só se aplica a tabelas que possuem
-- uma coluna chamada 'ativo' (motoristas, usuarios); tabelas sem essa
-- coluna simplesmente caem em 'edicao' para qualquer UPDATE.
-- ----------------------------------------------------------------------------
create or replace function public.fn_registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo_acao tipo_acao_auditoria;
  v_registro_id uuid;
  v_dados_anteriores jsonb;
  v_dados_novos jsonb;
  v_ativo_antes boolean;
  v_ativo_depois boolean;
begin
  if (tg_op = 'INSERT') then
    v_tipo_acao := 'criacao';
    v_registro_id := new.id;
    v_dados_anteriores := null;
    v_dados_novos := to_jsonb(new);

  elsif (tg_op = 'DELETE') then
    v_tipo_acao := 'exclusao_permanente';
    v_registro_id := old.id;
    v_dados_anteriores := to_jsonb(old);
    v_dados_novos := null;

  elsif (tg_op = 'UPDATE') then
    v_registro_id := new.id;
    v_dados_anteriores := to_jsonb(old);
    v_dados_novos := to_jsonb(new);

    -- Detecta inativação/reativação quando a tabela tem coluna 'ativo'
    if (v_dados_anteriores ? 'ativo') and (v_dados_novos ? 'ativo') then
      v_ativo_antes := (v_dados_anteriores->>'ativo')::boolean;
      v_ativo_depois := (v_dados_novos->>'ativo')::boolean;
      if v_ativo_antes is true and v_ativo_depois is false then
        v_tipo_acao := 'inativacao';
      elsif v_ativo_antes is false and v_ativo_depois is true then
        v_tipo_acao := 'reativacao';
      else
        v_tipo_acao := 'edicao';
      end if;
    else
      v_tipo_acao := 'edicao';
    end if;

  end if;

  insert into public.historico_auditoria (
    tabela_afetada, registro_id, tipo_acao,
    usuario_id, nome_usuario, dados_anteriores, dados_novos
  ) values (
    tg_table_name, v_registro_id, v_tipo_acao,
    auth.uid(), public.fn_nome_usuario_atual(),
    v_dados_anteriores, v_dados_novos
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.fn_registrar_auditoria() is
  'Trigger genérico e reutilizável de auditoria. Anexar como AFTER INSERT OR UPDATE OR DELETE em qualquer tabela auditável.';

-- ----------------------------------------------------------------------------
-- Anexa o trigger de auditoria às tabelas existentes
-- ----------------------------------------------------------------------------
drop trigger if exists trg_auditoria_motoristas on public.motoristas;
create trigger trg_auditoria_motoristas
  after insert or update or delete on public.motoristas
  for each row execute function public.fn_registrar_auditoria();

drop trigger if exists trg_auditoria_usuarios on public.usuarios;
create trigger trg_auditoria_usuarios
  after insert or update or delete on public.usuarios
  for each row execute function public.fn_registrar_auditoria();

-- Observação para as próximas etapas: para auditar uma nova tabela
-- (operacoes, e futuras tabelas de configurações), basta executar:
--
--   drop trigger if exists trg_auditoria_<tabela> on public.<tabela>;
--   create trigger trg_auditoria_<tabela>
--     after insert or update or delete on public.<tabela>
--     for each row execute function public.fn_registrar_auditoria();
--
-- Nenhuma alteração na função fn_registrar_auditoria() é necessária.

-- ============================================================================
-- ROW LEVEL SECURITY
-- Somente administradores podem visualizar o histórico de auditoria.
-- Ninguém (nem administrador) pode inserir/atualizar/excluir diretamente
-- via API — a tabela só é escrita pelo trigger (que roda como
-- security definer, contornando RLS na escrita), preservando a garantia
-- de "nunca apagar registros automaticamente" e de que o histórico não
-- pode ser manipulado por fora do fluxo de auditoria.
-- ============================================================================
alter table public.historico_auditoria enable row level security;

drop policy if exists "auditoria_select_admin" on public.historico_auditoria;
create policy "auditoria_select_admin"
  on public.historico_auditoria for select
  to authenticated
  using (public.fn_meu_perfil() = 'administrador');

-- Nenhuma policy de insert/update/delete é criada propositalmente: a tabela
-- só pode ser escrita pela função fn_registrar_auditoria(), que roda como
-- security definer (privilégios do dono da função) e portanto não passa
-- pela checagem de RLS de insert. Chamadas diretas via API REST do
-- Supabase para inserir/alterar/excluir em historico_auditoria são
-- bloqueadas por padrão (RLS habilitado sem policy permissiva = nega tudo).

-- ============================================================================
-- Fim da migration 0003. Nenhum dado fictício foi inserido.
-- ============================================================================
