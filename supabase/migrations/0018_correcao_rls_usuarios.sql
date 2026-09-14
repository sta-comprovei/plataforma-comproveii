-- ============================================================================
-- 0018_correcao_rls_usuarios.sql
-- Correção definitiva do RLS recursivo em public.usuarios
--
-- PROBLEMA: a policy "usuarios_select_proprio_ou_admin" chamava fn_meu_perfil()
-- que faz SELECT em public.usuarios — criando recursão infinita no PostgreSQL.
-- O banco interrompe com "permission denied for table usuarios" (HTTP 403).
--
-- SOLUÇÃO:
--   1. Policy SELECT simplificada: cada autenticado lê só a própria linha.
--   2. fn_listar_usuarios() SECURITY DEFINER: admins listam todos sem recursão.
--   3. GRANTs garantidos em todas as tabelas e funções.
--
-- APLICAR: Supabase Dashboard → SQL Editor → Execute
-- ============================================================================

-- ── 1. Remover policy recursiva e criar a correta ───────────────────────────
drop policy if exists "usuarios_select_proprio_ou_admin" on public.usuarios;
drop policy if exists "usuarios_select_proprio" on public.usuarios;

create policy "usuarios_select_proprio"
  on public.usuarios
  for select
  to authenticated
  using ( id = auth.uid() );

-- ── 2. Função para admins listarem todos os usuários ────────────────────────
create or replace function public.fn_listar_usuarios()
returns setof public.usuarios
language sql
security definer
stable
set search_path = public
as $$
  select * from public.usuarios order by nome;
$$;

revoke all on function public.fn_listar_usuarios() from public, anon;
grant execute on function public.fn_listar_usuarios() to authenticated;

-- ── 3. GRANTs em todas as tabelas (garante que authenticated possa acessar) ─
grant select, insert, update, delete on public.motoristas                to authenticated;
grant select, insert, update, delete on public.operacoes                 to authenticated;
grant select, insert, update, delete on public.metas_lead_time           to authenticated;
grant select, insert, update, delete on public.prazo_rotas               to authenticated;
grant select, insert, update, delete on public.alertas_operacionais      to authenticated;
grant select, insert, update, delete on public.comunicados_operacionais  to authenticated;
grant select, insert, update, delete on public.alteracoes_operacionais   to authenticated;
grant select, insert, update, delete on public.historico_importacoes     to authenticated;
grant select, insert, update, delete on public.arquivos_importados_controle to authenticated;
grant select, insert, update, delete on public.registros_rotina          to authenticated;
grant select, insert, update, delete on public.registros_comprovei       to authenticated;
grant select, insert, update, delete on public.snapshots_rotina          to authenticated;
grant select, insert, update, delete on public.snapshots_comprovei       to authenticated;
grant select, insert, update, delete on public.comprovei_status_motorista to authenticated;
grant select, insert, update, delete on public.historico_auditoria       to authenticated;
grant select                          on public.usuarios                  to authenticated;

grant select on public.vw_funil_kpis                    to authenticated;
grant select on public.vw_pedidos_consolidados          to authenticated;
grant select on public.vw_gargalos_etapas               to authenticated;
grant select on public.vw_tempos_etapas                 to authenticated;
grant select on public.vw_evolucao_gargalos             to authenticated;
grant select on public.vw_ranking_gargalos              to authenticated;
grant select on public.vw_sla_entregas                  to authenticated;
grant select on public.vw_sla_entregas_com_tolerancia   to authenticated;
grant select on public.vw_sla_kpis                      to authenticated;
grant select on public.vw_sla_kpis_com_tolerancia       to authenticated;
grant select on public.vw_alertas_operacionais          to authenticated;
grant select on public.vw_evolucao_mensal               to authenticated;
grant select on public.vw_performance_rotas             to authenticated;

grant execute on function public.fn_meu_perfil()        to authenticated;
grant execute on function public.fn_estou_ativo()       to authenticated;
grant execute on function public.fn_listar_usuarios()   to authenticated;
grant execute on function public.fn_nome_usuario_atual() to authenticated;

-- ── 4. Verificação ──────────────────────────────────────────────────────────
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'usuarios'
order by cmd;
