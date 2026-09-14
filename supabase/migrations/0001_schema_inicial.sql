-- ============================================================================
-- TNS Gestão de Entregas — Schema inicial
-- ============================================================================
-- Este arquivo cria toda a estrutura de banco de dados necessária para a
-- etapa de fundação da plataforma: autenticação, controle de permissões,
-- motoristas e operações. Nenhum dado fictício ou de demonstração é inserido.
--
-- Como aplicar:
--   1. Supabase Dashboard → SQL Editor → cole este arquivo → Run
--   2. OU via Supabase CLI:  supabase db push
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensões necessárias
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Tipos enumerados
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'perfil_usuario') then
    create type perfil_usuario as enum ('administrador', 'operador');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_operacao') then
    create type tipo_operacao as enum ('DF', 'Adega', 'Filial');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_operacao') then
    create type status_operacao as enum (
      'Em trânsito',
      'Chegada ao cliente',
      'Pendente',
      'Entrega finalizada',
      'Concluído'
    );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Tabela: usuarios
-- Espelha auth.users (1:1) e guarda perfil/permissão de cada conta.
-- O id é o MESMO id de auth.users.id — não existe cadastro de senha aqui,
-- a senha vive exclusivamente no Supabase Auth.
-- ----------------------------------------------------------------------------
create table if not exists public.usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text not null unique,
  perfil      perfil_usuario not null default 'operador',
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.usuarios is 'Perfil e permissões de cada usuário autenticado. 1:1 com auth.users.';
comment on column public.usuarios.perfil is 'administrador = acesso total; operador = sem Configurações nem cadastro de usuários.';
comment on column public.usuarios.ativo is 'Usuários inativos têm o acesso bloqueado mesmo com credenciais corretas.';

-- ----------------------------------------------------------------------------
-- Tabela: motoristas
-- Cadastro da frota. Sem dados de exemplo — populada manualmente ou via
-- importação posterior pelo usuário administrador.
-- ----------------------------------------------------------------------------
create table if not exists public.motoristas (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,
  nome        text not null,
  placa       text,
  veiculo     text,
  frota       text,
  telefone    text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.usuarios(id) on delete set null
);

comment on table public.motoristas is 'Cadastro de motoristas/frota da empresa.';

-- ----------------------------------------------------------------------------
-- Tabela: operacoes
-- Operação diária de entrega de um motorista. O ciclo de vida completo
-- (criação → acompanhamento → finalização → arquivamento) é controlado
-- pela coluna `ativa`, calculada automaticamente via trigger.
-- ----------------------------------------------------------------------------
create table if not exists public.operacoes (
  id              uuid primary key default gen_random_uuid(),
  motorista_id    uuid not null references public.motoristas(id) on delete restrict,

  data            date not null,
  tipo_operacao   tipo_operacao not null,
  rota            text not null,
  placa           text,

  previstas       integer not null default 0 check (previstas >= 0),
  realizadas      integer not null default 0 check (realizadas >= 0),
  percentual      integer generated always as (
                    case when previstas > 0
                      then least(100, round((realizadas::numeric / previstas) * 100))
                      else 0
                    end
                  ) stored,

  status          status_operacao not null default 'Em trânsito',
  divergencia     text,
  observacoes     text,

  dt_inicio       date,
  hr_inicio       time,
  dt_fim          date,
  hr_fim          time,

  -- Lead time em minutos, calculado via trigger sempre que início/fim mudam
  lead_time_min   integer,

  -- true = aparece em "Operação do Dia"; false = arquivada no Histórico
  ativa           boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.usuarios(id) on delete set null
);

comment on table public.operacoes is 'Operação de entrega de um motorista em uma data. Ciclo de vida controlado pela coluna ativa.';
comment on column public.operacoes.ativa is 'true enquanto em andamento (aparece em Operação do Dia); false quando finalizada (vai para o Histórico).';
comment on column public.operacoes.lead_time_min is 'Diferença em minutos entre início e fim, calculada automaticamente via trigger.';

-- ----------------------------------------------------------------------------
-- Índices
-- ----------------------------------------------------------------------------
create index if not exists idx_operacoes_motorista   on public.operacoes (motorista_id);
create index if not exists idx_operacoes_data         on public.operacoes (data);
create index if not exists idx_operacoes_ativa        on public.operacoes (ativa);
create index if not exists idx_operacoes_tipo         on public.operacoes (tipo_operacao);
create index if not exists idx_operacoes_status       on public.operacoes (status);
create index if not exists idx_motoristas_codigo      on public.motoristas (codigo);
create index if not exists idx_motoristas_ativo       on public.motoristas (ativo);
create index if not exists idx_usuarios_email         on public.usuarios (email);

-- ----------------------------------------------------------------------------
-- Função utilitária: calcula lead time e mantém a flag `ativa` consistente
-- ----------------------------------------------------------------------------
create or replace function public.fn_operacoes_before_write()
returns trigger
language plpgsql
as $$
begin
  -- Lead time só existe quando início e fim estão completos
  if new.dt_inicio is not null and new.hr_inicio is not null
     and new.dt_fim is not null and new.hr_fim is not null then
    new.lead_time_min := greatest(
      0,
      round(
        extract(
          epoch from (
            (new.dt_fim + new.hr_fim) - (new.dt_inicio + new.hr_inicio)
          )
        ) / 60
      )
    );
  else
    new.lead_time_min := null;
  end if;

  -- Uma operação fica inativa (vai para o Histórico) somente quando:
  --   status indica conclusão E existe data/hora de finalização
  if new.status in ('Concluído', 'Entrega finalizada')
     and new.dt_fim is not null and new.hr_fim is not null then
    new.ativa := false;
  else
    new.ativa := true;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_operacoes_before_write on public.operacoes;
create trigger trg_operacoes_before_write
  before insert or update on public.operacoes
  for each row execute function public.fn_operacoes_before_write();

-- ----------------------------------------------------------------------------
-- Função utilitária: updated_at automático em motoristas
-- ----------------------------------------------------------------------------
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_motoristas_updated_at on public.motoristas;
create trigger trg_motoristas_updated_at
  before update on public.motoristas
  for each row execute function public.fn_set_updated_at();

-- ----------------------------------------------------------------------------
-- Função: cria automaticamente a linha em public.usuarios quando uma conta
-- é criada no Supabase Auth (signup). Perfil padrão = operador / ativo = true.
-- Um administrador deve promover o usuário manualmente depois, se necessário.
-- ----------------------------------------------------------------------------
create or replace function public.fn_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuarios (id, nome, email, perfil, ativo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    'operador',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- Função utilitária para políticas RLS: perfil do usuário autenticado atual
-- ----------------------------------------------------------------------------
create or replace function public.fn_meu_perfil()
returns perfil_usuario
language sql
security definer
stable
set search_path = public
as $$
  select perfil from public.usuarios where id = auth.uid();
$$;

create or replace function public.fn_estou_ativo()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select ativo from public.usuarios where id = auth.uid()), false);
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.usuarios   enable row level security;
alter table public.motoristas enable row level security;
alter table public.operacoes  enable row level security;

-- ---- usuarios ---------------------------------------------------------------
drop policy if exists "usuarios_select_proprio_ou_admin" on public.usuarios;
create policy "usuarios_select_proprio_ou_admin"
  on public.usuarios for select
  to authenticated
  using (
    id = auth.uid()
    or public.fn_meu_perfil() = 'administrador'
  );

drop policy if exists "usuarios_insert_admin" on public.usuarios;
create policy "usuarios_insert_admin"
  on public.usuarios for insert
  to authenticated
  with check (public.fn_meu_perfil() = 'administrador');

drop policy if exists "usuarios_update_admin" on public.usuarios;
create policy "usuarios_update_admin"
  on public.usuarios for update
  to authenticated
  using (public.fn_meu_perfil() = 'administrador')
  with check (public.fn_meu_perfil() = 'administrador');

drop policy if exists "usuarios_delete_admin" on public.usuarios;
create policy "usuarios_delete_admin"
  on public.usuarios for delete
  to authenticated
  using (public.fn_meu_perfil() = 'administrador');

-- ---- motoristas --------------------------------------------------------------
-- Qualquer usuário ativo (administrador ou operador) pode ler e escrever.
drop policy if exists "motoristas_select_ativos" on public.motoristas;
create policy "motoristas_select_ativos"
  on public.motoristas for select
  to authenticated
  using (public.fn_estou_ativo());

drop policy if exists "motoristas_insert_ativos" on public.motoristas;
create policy "motoristas_insert_ativos"
  on public.motoristas for insert
  to authenticated
  with check (public.fn_estou_ativo());

drop policy if exists "motoristas_update_ativos" on public.motoristas;
create policy "motoristas_update_ativos"
  on public.motoristas for update
  to authenticated
  using (public.fn_estou_ativo())
  with check (public.fn_estou_ativo());

drop policy if exists "motoristas_delete_admin" on public.motoristas;
create policy "motoristas_delete_admin"
  on public.motoristas for delete
  to authenticated
  using (public.fn_meu_perfil() = 'administrador');

-- ---- operacoes ----------------------------------------------------------------
drop policy if exists "operacoes_select_ativos" on public.operacoes;
create policy "operacoes_select_ativos"
  on public.operacoes for select
  to authenticated
  using (public.fn_estou_ativo());

drop policy if exists "operacoes_insert_ativos" on public.operacoes;
create policy "operacoes_insert_ativos"
  on public.operacoes for insert
  to authenticated
  with check (public.fn_estou_ativo());

drop policy if exists "operacoes_update_ativos" on public.operacoes;
create policy "operacoes_update_ativos"
  on public.operacoes for update
  to authenticated
  using (public.fn_estou_ativo())
  with check (public.fn_estou_ativo());

drop policy if exists "operacoes_delete_admin" on public.operacoes;
create policy "operacoes_delete_admin"
  on public.operacoes for delete
  to authenticated
  using (public.fn_meu_perfil() = 'administrador');

-- ============================================================================
-- Fim do schema inicial. Nenhum dado fictício foi inserido.
-- ============================================================================
