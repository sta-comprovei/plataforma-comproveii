-- ============================================================================
-- Rastreamento de Reentrega — Migration 0002
-- Reentregas por nota fiscal, alinhadas pelo SAC com um novo motorista.
-- ============================================================================
-- Cada linha é UMA nota fiscal. O mesmo lote (várias notas repassadas pelo
-- SAC de uma vez, para o mesmo motorista, com o mesmo print) vira várias
-- linhas — uma por nota — criadas juntas pelo frontend.
--
-- Duas situações, controladas por `status`:
--   AGUARDANDO_MOTORISTA → possível reentrega já sinalizada pelo SAC, mas
--                           ainda sem motorista definido (motorista_atual
--                           fica nulo). Aparece na aba "Aguardando motorista".
--   REGISTRADA           → motorista_atual definido e `data_alinhamento`
--                           preenchida. Aparece na aba "Reentregas registradas".
--
-- O print da conversa (`print_path`) é opcional em qualquer situação e
-- aponta para um objeto no bucket de storage 'reentregas-prints' (privado —
-- o frontend gera signed URL sob demanda, nunca expõe o bucket publicamente).
--
-- Exclusão é física (com confirmação na tela) — não há lixeira nesta
-- plataforma enxuta. `usuario_criacao`/`usuario_ultima_alteracao` guardam
-- quem fez o quê diretamente na própria linha.
-- ============================================================================

create table if not exists public.reentregas_notas (
  id                        uuid primary key default gen_random_uuid(),

  nota_fiscal               text not null,

  motorista_anterior        text not null,
  motorista_atual           text,

  status                    text not null default 'AGUARDANDO_MOTORISTA'
                              check (status in ('AGUARDANDO_MOTORISTA', 'REGISTRADA')),

  -- Motorista definido só pode existir junto com o status REGISTRADA, e
  -- vice-versa — garante a integridade mesmo se alguém escrever direto na
  -- tabela sem passar pelo service.
  constraint reentregas_status_motorista_ck check (
    (status = 'REGISTRADA' and motorista_atual is not null and btrim(motorista_atual) <> '')
    or
    (status = 'AGUARDANDO_MOTORISTA' and motorista_atual is null)
  ),

  observacao                text,

  print_path                text,   -- caminho no bucket 'reentregas-prints', ou null
  print_nome_arquivo         text,

  data_alinhamento           timestamptz,  -- preenchida quando entra em REGISTRADA

  usuario_criacao            text not null default 'Sistema',
  usuario_ultima_alteracao   text,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

comment on table public.reentregas_notas is
  'Reentregas por nota fiscal alinhadas pelo SAC com um novo motorista. '
  'Uma linha por nota. print_path aponta para o bucket privado reentregas-prints.';

comment on column public.reentregas_notas.motorista_anterior is
  'Motorista que estava com a entrega originalmente.';
comment on column public.reentregas_notas.motorista_atual is
  'Motorista que vai levar a reentrega. Nulo enquanto status = AGUARDANDO_MOTORISTA.';
comment on column public.reentregas_notas.print_path is
  'Caminho do objeto no bucket de storage reentregas-prints (privado). Opcional.';

-- Índices — nota_fiscal é o campo mais pesquisado da tela
create index if not exists idx_reentregas_nota_fiscal   on public.reentregas_notas (nota_fiscal);
create index if not exists idx_reentregas_status         on public.reentregas_notas (status);
create index if not exists idx_reentregas_created_at     on public.reentregas_notas (created_at desc);
create index if not exists idx_reentregas_motorista_ant  on public.reentregas_notas (motorista_anterior);
create index if not exists idx_reentregas_motorista_atu  on public.reentregas_notas (motorista_atual);

-- ── Trigger: normaliza campos e mantém updated_at/data_alinhamento em dia ───
create or replace function public.fn_reentregas_before_write()
returns trigger
language plpgsql
as $$
begin
  new.nota_fiscal := btrim(new.nota_fiscal);
  if new.motorista_anterior is not null then
    new.motorista_anterior := btrim(new.motorista_anterior);
  end if;
  if new.motorista_atual is not null then
    new.motorista_atual := nullif(btrim(new.motorista_atual), '');
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  -- Transição para REGISTRADA (recém-definido motorista_atual): carimba a
  -- data do alinhamento, sem sobrescrever se já existir (ex.: edição simples).
  if new.status = 'REGISTRADA' and new.data_alinhamento is null then
    new.data_alinhamento := now();
  end if;
  if new.status = 'AGUARDANDO_MOTORISTA' then
    new.data_alinhamento := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reentregas_before_write on public.reentregas_notas;
create trigger trg_reentregas_before_write
  before insert or update on public.reentregas_notas
  for each row execute function public.fn_reentregas_before_write();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.reentregas_notas enable row level security;

drop policy if exists "reentregas_select" on public.reentregas_notas;
create policy "reentregas_select"
  on public.reentregas_notas for select
  to authenticated using (public.fn_estou_ativo());

drop policy if exists "reentregas_insert" on public.reentregas_notas;
create policy "reentregas_insert"
  on public.reentregas_notas for insert
  to authenticated with check (public.fn_estou_ativo());

drop policy if exists "reentregas_update" on public.reentregas_notas;
create policy "reentregas_update"
  on public.reentregas_notas for update
  to authenticated
  using (public.fn_estou_ativo())
  with check (public.fn_estou_ativo());

-- DELETE: só quem tem perfil administrador (a tela só mostra o botão de
-- excluir para esse perfil, e a policy garante isso também no banco).
drop policy if exists "reentregas_delete" on public.reentregas_notas;
create policy "reentregas_delete"
  on public.reentregas_notas for delete
  to authenticated
  using (public.fn_meu_perfil() = 'administrador');

grant select, insert, update, delete on public.reentregas_notas to authenticated;

-- ============================================================================
-- Storage: bucket privado para os prints de conversa (opcionais)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('reentregas-prints', 'reentregas-prints', false)
on conflict (id) do nothing;

drop policy if exists "reentregas_prints_select" on storage.objects;
create policy "reentregas_prints_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'reentregas-prints' and public.fn_estou_ativo());

drop policy if exists "reentregas_prints_insert" on storage.objects;
create policy "reentregas_prints_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'reentregas-prints' and public.fn_estou_ativo());

drop policy if exists "reentregas_prints_delete" on storage.objects;
create policy "reentregas_prints_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'reentregas-prints' and public.fn_estou_ativo());

-- ── Verificação ───────────────────────────────────────────────────────────────
select 'reentregas_notas criada' as status, count(*) as politicas_rls
from pg_policies
where tablename = 'reentregas_notas';

-- ============================================================================
-- Fim da migration 0002.
-- ============================================================================
