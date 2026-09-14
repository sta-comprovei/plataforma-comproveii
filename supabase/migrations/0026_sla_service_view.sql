create or replace function public.fn_prazo_efetivo_minutos(p_rota text, p_tipo_operacao text) returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(
    (select coalesce(pr.prazo_horas,pr.prazo_dias*24)*60 from public.prazo_rotas pr where upper(trim(pr.rota))=upper(trim(p_rota)) and pr.ativo=true and pr.vigente_ate is null limit 1),
    (select ml.meta_minutos::numeric from public.metas_lead_time ml where ml.tipo_operacao=p_tipo_operacao limit 1)
  )
$$;
grant execute on function public.fn_prazo_efetivo_minutos(text,text) to authenticated;

create or replace view public.vw_lead_time_por_rota as
with ops as (select rota,tipo_operacao,lead_time_min,data_operacao from public.operacoes where lead_time_min is not null and rota is not null and rota<>''),
por_rota as (select rota,(select tipo_operacao from ops o2 where o2.rota=ops.rota group by tipo_operacao order by count(*) desc limit 1) as tipo_operacao_principal,count(*) as total_viagens,round(avg(lead_time_min)::numeric,0) as media_min,min(lead_time_min) as minimo_min,max(lead_time_min) as maximo_min from ops group by rota),
com_prazo as (select pr.*,(select coalesce(p.prazo_horas,p.prazo_dias*24)*60 from public.prazo_rotas p where upper(trim(p.rota))=upper(trim(pr.rota)) and p.ativo=true and p.vigente_ate is null limit 1) as prazo_rota_min,(select p.prazo_dias from public.prazo_rotas p where upper(trim(p.rota))=upper(trim(pr.rota)) and p.ativo=true and p.vigente_ate is null limit 1) as prazo_rota_dias,(select ml.meta_minutos from public.metas_lead_time ml where ml.tipo_operacao=pr.tipo_operacao_principal limit 1) as meta_categoria_min from por_rota pr)
select rota,tipo_operacao_principal,total_viagens,media_min,minimo_min,maximo_min,prazo_rota_min,prazo_rota_dias,meta_categoria_min,coalesce(prazo_rota_min,meta_categoria_min) as prazo_efetivo_min,
case when prazo_rota_min is not null then 'rota' when meta_categoria_min is not null then 'categoria' else 'sem_prazo' end as fonte_prazo,
case when coalesce(prazo_rota_min,meta_categoria_min)>0 then round((media_min::numeric/coalesce(prazo_rota_min,meta_categoria_min))*100,1) end as eficiencia_pct,
case when coalesce(prazo_rota_min,meta_categoria_min) is null then 'sem_prazo' when media_min<=coalesce(prazo_rota_min,meta_categoria_min) then 'verde' when media_min<=coalesce(prazo_rota_min,meta_categoria_min)*1.1 then 'amarelo' else 'vermelho' end as situacao,
case when coalesce(prazo_rota_min,meta_categoria_min) is not null then media_min-coalesce(prazo_rota_min,meta_categoria_min) end as diferenca_min
from com_prazo order by case when coalesce(prazo_rota_min,meta_categoria_min) is null then 2 when media_min>coalesce(prazo_rota_min,meta_categoria_min) then 0 else 1 end,media_min desc;
