-- ============================================================================
-- 0022_lixeira.sql
-- Lixeira central da plataforma TNS Gestão de Entregas.
--
-- Qualquer exclusão na plataforma move o registro para esta tabela.
-- Nenhum registro é deletado fisicamente ao clicar em "Excluir" nas telas.
-- A exclusão definitiva (hard delete) é operação exclusiva de administrador.
-- ============================================================================

-- ── Tabela principal ──────────────────────────────────────────────────────────
create table if not exists public.lixeira (
  id                uuid primary key default gen_random_uuid(),
  tabela_origem     text        not null,   -- ex: 'motoristas', 'operacoes'
  registro_id       uuid        not null,   -- PK original do registro excluído
  descricao         text        not null,   -- texto legível para exibição
  dados_json        jsonb       not null,   -- snapshot completo do registro
  usuario_exclusao  text        not null,   -- nome do usuário que excluiu
  data_exclusao     timestamptz not null default now(),
  -- Soft delete definitivo: somente administrador pode marcar para remoção
  excluido_definitivamente boolean not null default false,
  data_exclusao_definitiva  timestamptz
);

comment on table public.lixeira is
  'Lixeira central da plataforma. Registros excluídos pelas telas chegam aqui '
  'antes de qualquer possível remoção definitiva. Somente administradores '
  'podem excluir definitivamente.';

-- Índices para filtros da tela de Lixeira
create index if not exists idx_lixeira_tabela_origem
  on public.lixeira (tabela_origem);
create index if not exists idx_lixeira_data_exclusao
  on public.lixeira (data_exclusao desc);
create index if not exists idx_lixeira_usuario
  on public.lixeira (usuario_exclusao);
create index if not exists idx_lixeira_definitivo
  on public.lixeira (excluido_definitivamente);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.lixeira enable row level security;

-- Leitura: qualquer usuário ativo pode ver a lixeira
drop policy if exists "lixeira_select" on public.lixeira;
create policy "lixeira_select"
  on public.lixeira for select
  to authenticated
  using (public.fn_estou_ativo() and excluido_definitivamente = false);

-- Inserção: qualquer usuário ativo pode mover registros para a lixeira
drop policy if exists "lixeira_insert" on public.lixeira;
create policy "lixeira_insert"
  on public.lixeira for insert
  to authenticated
  with check (public.fn_estou_ativo());

-- UPDATE (marcar como excluído definitivamente): somente administrador
drop policy if exists "lixeira_update" on public.lixeira;
create policy "lixeira_update"
  on public.lixeira for update
  to authenticated
  using (public.fn_meu_perfil() = 'administrador')
  with check (public.fn_meu_perfil() = 'administrador');

-- DELETE físico da tabela lixeira: somente administrador
drop policy if exists "lixeira_delete" on public.lixeira;
create policy "lixeira_delete"
  on public.lixeira for delete
  to authenticated
  using (public.fn_meu_perfil() = 'administrador');

grant select, insert, update, delete on public.lixeira to authenticated;

-- ── fn_mover_para_lixeira ─────────────────────────────────────────────────────
-- Insere snapshot na lixeira. Chamada pelos services ANTES do DELETE físico.
create or replace function public.fn_mover_para_lixeira(
  p_tabela_origem    text,
  p_registro_id      uuid,
  p_descricao        text,
  p_dados_json       jsonb,
  p_usuario_exclusao text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.lixeira (
    tabela_origem, registro_id, descricao, dados_json, usuario_exclusao
  )
  values (
    p_tabela_origem, p_registro_id, p_descricao, p_dados_json, p_usuario_exclusao
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.fn_mover_para_lixeira(text,uuid,text,jsonb,text) from public, anon;
grant execute on function public.fn_mover_para_lixeira(text,uuid,text,jsonb,text) to authenticated;

-- ── fn_excluir_definitivamente_lixeira ───────────────────────────────────────
-- Exclusão definitiva de um item da lixeira. Somente administrador.
create or replace function public.fn_excluir_definitivamente_lixeira(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fn_meu_perfil() <> 'administrador' then
    raise exception 'Exclusão definitiva restrita a administradores.';
  end if;

  delete from public.lixeira where id = p_id;
end;
$$;

revoke all on function public.fn_excluir_definitivamente_lixeira(uuid) from public, anon;
grant execute on function public.fn_excluir_definitivamente_lixeira(uuid) to authenticated;

-- ── Verificação ───────────────────────────────────────────────────────────────
select 'lixeira criada' as status, count(*) as politicas_rls
from pg_policies
where tablename = 'lixeira';
