create or replace function public.fn_normalizar_rota(p_rota text) returns text language sql immutable set search_path = public as $$ select trim(regexp_replace(lower(translate(coalesce(p_rota,''),'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ','aaaaaeeeeiiiioooooouuuucAAAAEEEEIIIIOOOOOUUUUC')),'\s+', ' ', 'g')) $$;
grant execute on function public.fn_normalizar_rota(text) to authenticated;

create or replace function public.fn_rotas_duplicadas() returns table(rota_normalizada text, rotas text[], total_operacoes bigint, total_lead_time bigint, lead_time_medio numeric) language sql stable security definer set search_path = public as $$
  with rotas_unicas as (select distinct rota from public.operacoes where rota is not null and rota <> ''),
  rotas_normalizadas as (select rota, public.fn_normalizar_rota(rota) as normalizada from rotas_unicas),
  grupos as (select normalizada, array_agg(rota order by rota) as rotas, count(*) as qtd_variantes from rotas_normalizadas group by normalizada having count(*) > 1)
  select g.normalizada, g.rotas, count(o.id), count(o.lead_time_min), round(avg(o.lead_time_min)/60.0,1)
  from grupos g join public.operacoes o on public.fn_normalizar_rota(o.rota) = g.normalizada
  group by g.normalizada, g.rotas order by count(o.id) desc;
$$;
grant execute on function public.fn_rotas_duplicadas() to authenticated;

create or replace function public.fn_buscar_rotas_semelhantes(p_rota text) returns table(rota text, total_operacoes bigint) language sql stable security definer set search_path = public as $$
  select o.rota, count(o.id) from public.operacoes o where public.fn_normalizar_rota(o.rota) = public.fn_normalizar_rota(p_rota) and lower(trim(o.rota)) <> lower(trim(p_rota)) and o.rota is not null and o.rota <> '' group by o.rota order by count(o.id) desc limit 10;
$$;
grant execute on function public.fn_buscar_rotas_semelhantes(text) to authenticated;

create or replace function public.fn_fundir_rotas(p_rota_antiga text, p_rota_nova text, p_usuario text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_qtd_operacoes int:=0; v_qtd_prazo int:=0;
begin
  if public.fn_meu_perfil()<>'administrador' then raise exception 'Restrito a administradores.'; end if;
  update public.operacoes set rota=p_rota_nova where rota=p_rota_antiga; GET DIAGNOSTICS v_qtd_operacoes=ROW_COUNT;
  update public.prazo_rotas set rota=p_rota_nova where rota=p_rota_antiga; GET DIAGNOSTICS v_qtd_prazo=ROW_COUNT;
  insert into public.historico_auditoria(tabela,operacao,dados_novos,usuario_responsavel) values('fusao_rotas','UPDATE',jsonb_build_object('rota_antiga',p_rota_antiga,'rota_nova',p_rota_nova,'operacoes',v_qtd_operacoes,'prazo_rotas',v_qtd_prazo),p_usuario);
  return jsonb_build_object('sucesso',true,'operacoes',v_qtd_operacoes,'prazo_rotas',v_qtd_prazo);
end;$$;
grant execute on function public.fn_fundir_rotas(text,text,text) to authenticated;
