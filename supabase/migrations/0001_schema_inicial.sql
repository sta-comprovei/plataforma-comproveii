-- ============================================================================
-- Rastreamento de Reentrega — Schema inicial
-- ============================================================================
-- Cria a base de autenticação/permissão da plataforma: perfil de usuário,
-- a tabela `usuarios` (espelha auth.users 1:1) e o auto-provisionamento no
-- signup. Nenhum dado fictício ou de demonstração é inserido.
--
-- Como aplicar:
--   1. Supabase Dashboard → SQL Editor → cole este arquivo → Run
--   2. OU via Supabase CLI:  supabase db push
-- ============================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Tipo enumerado: perfil de acesso
-- administrador = acesso total (inclui excluir reentregas)
-- operador      = pode registrar/editar reentregas, não pode excluir
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'perfil_usuario') then
    create type perfil_usuario as enum ('administrador', 'operador');
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
comment on column public.usuarios.perfil is 'administrador = acesso total; operador = registra/edita, não exclui.';
comment on column public.usuarios.ativo is 'Usuários inativos têm o acesso bloqueado mesmo com credenciais corretas.';

create index if not exists idx_usuarios_email on public.usuarios (email);

-- ----------------------------------------------------------------------------
-- Função: cria automaticamente a linha em public.usuarios quando uma conta
-- é criada no Supabase Auth (signup ou convite pelo painel). Perfil padrão
-- é operador/ativo — um administrador promove manualmente depois, se preciso:
--   update public.usuarios set perfil = 'administrador' where email = '...';
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
-- Funções utilitárias para políticas RLS (reaproveitadas por qualquer
-- tabela futura, ex.: reentregas_notas na migration 0002)
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
alter table public.usuarios enable row level security;

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

grant select, insert, update, delete on public.usuarios to authenticated;

-- ============================================================================
-- Fim do schema inicial. Nenhum dado fictício foi inserido.
-- ============================================================================
