alter table public.operacoes
  add column if not exists status_operacional text not null default 'ATIVA' check (status_operacional in ('ATIVA','PENDENTE','FINALIZADA')),
  add column if not exists motivo_pendencia text,
  add column if not exists descricao_pendencia text,
  add column if not exists observacao_pendencia text,
  add column if not exists data_pendencia timestamptz,
  add column if not exists usuario_pendencia text;

create index if not exists idx_operacoes_status_operacional on public.operacoes(status_operacional) where status_operacional='PENDENTE';
update public.operacoes set status_operacional='FINALIZADA' where ativa=false;

create or replace function public.fn_marcar_pendente(p_id uuid, p_motivo text, p_descricao text default null, p_observacao text default null, p_usuario text default null) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.operacoes where id=p_id and status_operacional='ATIVA') then raise exception 'Operação não encontrada ou não está ativa.'; end if;
  update public.operacoes set status_operacional='PENDENTE',motivo_pendencia=p_motivo,descricao_pendencia=p_descricao,observacao_pendencia=p_observacao,data_pendencia=now(),usuario_pendencia=p_usuario where id=p_id;
end;$$;
grant execute on function public.fn_marcar_pendente(uuid,text,text,text,text) to authenticated;

create or replace function public.fn_retornar_para_operacao(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.operacoes where id=p_id and status_operacional='PENDENTE') then raise exception 'Operação não está pendente.'; end if;
  update public.operacoes set status_operacional='ATIVA',motivo_pendencia=null,descricao_pendencia=null,observacao_pendencia=null,data_pendencia=null,usuario_pendencia=null where id=p_id;
end;$$;
grant execute on function public.fn_retornar_para_operacao(uuid) to authenticated;

create or replace function public.fn_kpis_pendentes() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('total',count(*),'hoje',count(*) filter(where data_pendencia::date=current_date),'acima_3_dias',count(*) filter(where data_pendencia<now()-interval '3 days'),'acima_7_dias',count(*) filter(where data_pendencia<now()-interval '7 days'),'tempo_medio_horas',round(extract(epoch from avg(now()-data_pendencia))/3600.0,1)) from public.operacoes where status_operacional='PENDENTE';
$$;
grant execute on function public.fn_kpis_pendentes() to authenticated;
