-- ============================================================================
-- 0021_gestao_usuarios.sql
-- Módulo de Gestão de Usuários — funções SQL seguras.
--
-- ARQUITETURA:
--   Operações que LEEM auth.users (last_sign_in_at) → SECURITY DEFINER OK
--   Operações que ESCREVEM em auth.users            → Edge Functions (Admin API)
--
-- O que fica aqui (somente leitura de auth.users ou escrita em public.usuarios):
--   fn_contar_admins_ativos       — leitura public.usuarios
--   fn_listar_usuarios_admin      — leitura public.usuarios + JOIN auth.users (read)
--   fn_atualizar_dados_usuario    — UPDATE public.usuarios (nome, perfil, ativo)
--   fn_validar_exclusao_usuario   — verifica regras antes de excluir (sem escrever)
--   fn_excluir_de_public_usuarios — DELETE public.usuarios após Admin API já removeu auth
--
-- O que vai para Edge Functions (Admin API obrigatória):
--   admin-criar-usuario    → supabase.auth.admin.createUser()
--   admin-atualizar-email  → supabase.auth.admin.updateUserById({email})
--   admin-redefinir-senha  → supabase.auth.admin.updateUserById({password})
--   admin-excluir-usuario  → supabase.auth.admin.deleteUser() + chama fn_excluir_de_public_usuarios
-- ============================================================================

-- ── 1. Adicionar perfil gestor ao ENUM ───────────────────────────────────────
alter type public.perfil_usuario
  add value if not exists 'gestor';

comment on type public.perfil_usuario is
  'administrador = acesso total; gestor = acesso operacional ampliado; operador = acesso básico.';

-- ── 2. fn_contar_admins_ativos ───────────────────────────────────────────────
create or replace function public.fn_contar_admins_ativos(excluir_id uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.usuarios
  where perfil = 'administrador'
    and ativo = true
    and (excluir_id is null or id <> excluir_id);
$$;

revoke all on function public.fn_contar_admins_ativos(uuid) from public, anon;
grant  execute on function public.fn_contar_admins_ativos(uuid) to authenticated;

-- ── 3. fn_listar_usuarios_admin ──────────────────────────────────────────────
-- Leitura segura: JOIN com auth.users para obter last_sign_in_at.
-- Escrita em auth.users NUNCA ocorre aqui.
create or replace function public.fn_listar_usuarios_admin(
  p_busca      text    default null,
  p_perfil     text    default null,
  p_ativo      boolean default null,
  p_limite     integer default 100,
  p_offset     integer default 0
)
returns table (
  id              uuid,
  nome            text,
  email           text,
  perfil          public.perfil_usuario,
  ativo           boolean,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  total           bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fn_meu_perfil() <> 'administrador' then
    raise exception 'Acesso restrito a administradores.';
  end if;

  return query
    select
      u.id,
      u.nome,
      u.email,
      u.perfil,
      u.ativo,
      u.created_at,
      au.last_sign_in_at,
      count(*) over () as total
    from public.usuarios u
    left join auth.users au on au.id = u.id
    where
      (p_busca is null or p_busca = '' or
        u.nome  ilike '%' || p_busca || '%' or
        u.email ilike '%' || p_busca || '%')
      and (p_perfil is null or p_perfil = '' or u.perfil::text = p_perfil)
      and (p_ativo is null or u.ativo = p_ativo)
    order by u.nome
    limit  p_limite
    offset p_offset;
end;
$$;

revoke all on function public.fn_listar_usuarios_admin(text,text,boolean,integer,integer) from public, anon;
grant  execute on function public.fn_listar_usuarios_admin(text,text,boolean,integer,integer) to authenticated;

-- ── 4. fn_atualizar_dados_usuario ────────────────────────────────────────────
-- Atualiza SOMENTE public.usuarios: nome, perfil, ativo.
-- Alteração de e-mail é feita pela Edge Function admin-atualizar-email
-- (que usa Admin API e depois atualiza public.usuarios também).
create or replace function public.fn_atualizar_dados_usuario(
  p_id     uuid,
  p_nome   text    default null,
  p_perfil text    default null,
  p_ativo  boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario public.usuarios%rowtype;
  v_novo_perfil public.perfil_usuario;
begin
  if public.fn_meu_perfil() <> 'administrador' then
    raise exception 'Acesso restrito a administradores.';
  end if;

  select * into v_usuario from public.usuarios where id = p_id;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;

  -- Proteger o último administrador ativo
  if v_usuario.perfil = 'administrador' and v_usuario.ativo = true then
    if p_perfil is not null and p_perfil <> 'administrador' then
      if public.fn_contar_admins_ativos(p_id) = 0 then
        raise exception 'Não é possível alterar o perfil: este é o único administrador ativo.';
      end if;
    end if;
    if p_ativo = false then
      if public.fn_contar_admins_ativos(p_id) = 0 then
        raise exception 'Não é possível inativar: este é o único administrador ativo.';
      end if;
    end if;
  end if;

  if p_perfil is not null then
    v_novo_perfil := p_perfil::public.perfil_usuario;
  else
    v_novo_perfil := v_usuario.perfil;
  end if;

  update public.usuarios set
    nome   = coalesce(p_nome,  nome),
    perfil = v_novo_perfil,
    ativo  = coalesce(p_ativo, ativo)
  where id = p_id;
end;
$$;

revoke all on function public.fn_atualizar_dados_usuario(uuid,text,text,boolean) from public, anon;
grant  execute on function public.fn_atualizar_dados_usuario(uuid,text,text,boolean) to authenticated;

-- ── 5. fn_atualizar_email_usuario ────────────────────────────────────────────
-- Atualiza o e-mail SOMENTE em public.usuarios.
-- Chamada pela Edge Function admin-atualizar-email DEPOIS que a Admin API
-- já atualizou auth.users com sucesso.
create or replace function public.fn_atualizar_email_usuario(
  p_id    uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fn_meu_perfil() <> 'administrador' then
    raise exception 'Acesso restrito a administradores.';
  end if;

  if exists(select 1 from public.usuarios where email = p_email and id <> p_id) then
    raise exception 'Este e-mail já está cadastrado para outro usuário.';
  end if;

  update public.usuarios set email = p_email where id = p_id;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
end;
$$;

revoke all on function public.fn_atualizar_email_usuario(uuid,text) from public, anon;
grant  execute on function public.fn_atualizar_email_usuario(uuid,text) to authenticated;

-- ── 6. fn_validar_exclusao_usuario ───────────────────────────────────────────
-- Valida as regras de negócio antes de excluir. Não escreve nada.
-- Chamada pela Edge Function admin-excluir-usuario antes de chamar deleteUser().
create or replace function public.fn_validar_exclusao_usuario(p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario public.usuarios%rowtype;
begin
  if public.fn_meu_perfil() <> 'administrador' then
    raise exception 'Acesso restrito a administradores.';
  end if;

  if p_usuario_id = auth.uid() then
    raise exception 'Você não pode excluir sua própria conta.';
  end if;

  select * into v_usuario from public.usuarios where id = p_usuario_id;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;

  if v_usuario.perfil = 'administrador' and v_usuario.ativo = true then
    if public.fn_contar_admins_ativos(p_usuario_id) = 0 then
      raise exception 'Não é possível excluir: este é o único administrador ativo.';
    end if;
  end if;
end;
$$;

revoke all on function public.fn_validar_exclusao_usuario(uuid) from public, anon;
grant  execute on function public.fn_validar_exclusao_usuario(uuid) to authenticated;

-- ── 7. fn_excluir_de_public_usuarios ─────────────────────────────────────────
-- Remove o registro de public.usuarios APÓS a Admin API já ter removido auth.users.
-- Chamada pela Edge Function admin-excluir-usuario como último passo.
create or replace function public.fn_excluir_de_public_usuarios(p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fn_meu_perfil() <> 'administrador' then
    raise exception 'Acesso restrito a administradores.';
  end if;

  delete from public.usuarios where id = p_usuario_id;
end;
$$;

revoke all on function public.fn_excluir_de_public_usuarios(uuid) from public, anon;
grant  execute on function public.fn_excluir_de_public_usuarios(uuid) to authenticated;

-- ── 8. fn_inserir_em_public_usuarios ─────────────────────────────────────────
-- Insere registro em public.usuarios APÓS a Admin API criar o usuário em auth.users.
-- Chamada pela Edge Function admin-criar-usuario como segundo passo.
create or replace function public.fn_inserir_em_public_usuarios(
  p_id     uuid,
  p_nome   text,
  p_email  text,
  p_perfil text default 'operador'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fn_meu_perfil() <> 'administrador' then
    raise exception 'Acesso restrito a administradores.';
  end if;

  insert into public.usuarios (id, nome, email, perfil, ativo)
  values (p_id, p_nome, p_email, p_perfil::public.perfil_usuario, true);
end;
$$;

revoke all on function public.fn_inserir_em_public_usuarios(uuid,text,text,text) from public, anon;
grant  execute on function public.fn_inserir_em_public_usuarios(uuid,text,text,text) to authenticated;

-- ── Verificação ───────────────────────────────────────────────────────────────
select proname as funcao, prosecdef as security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and (proname like 'fn_%admin%' or proname like 'fn_%usuario%' or proname = 'fn_contar_admins_ativos')
order by proname;
