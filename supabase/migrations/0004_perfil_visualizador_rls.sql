-- ============================================================================
-- Rastreamento de Reentrega — Migration 0004
-- Restringe escrita para o perfil "visualizador": só pode ver reentregas e
-- prints, não pode criar, editar nem excluir nada.
-- ============================================================================
-- Rode SOMENTE DEPOIS de 0003_perfil_visualizador_enum.sql ter sido
-- executado com sucesso em sua própria transação.
-- ============================================================================

-- ── reentregas_notas ─────────────────────────────────────────────────────────
-- SELECT continua liberado para qualquer usuário ativo (inclui visualizador).
-- INSERT e UPDATE passam a exigir perfil administrador ou operador.

drop policy if exists "reentregas_insert" on public.reentregas_notas;
create policy "reentregas_insert"
  on public.reentregas_notas for insert
  to authenticated
  with check (public.fn_estou_ativo() and public.fn_meu_perfil() <> 'visualizador');

drop policy if exists "reentregas_update" on public.reentregas_notas;
create policy "reentregas_update"
  on public.reentregas_notas for update
  to authenticated
  using (public.fn_estou_ativo() and public.fn_meu_perfil() <> 'visualizador')
  with check (public.fn_estou_ativo() and public.fn_meu_perfil() <> 'visualizador');

-- DELETE já era restrito a administrador — nada muda aqui.

-- ── storage.objects (bucket reentregas-prints) ──────────────────────────────
-- SELECT continua liberado (visualizador precisa conseguir abrir os prints).
-- INSERT e DELETE passam a exigir perfil administrador ou operador.

drop policy if exists "reentregas_prints_insert" on storage.objects;
create policy "reentregas_prints_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'reentregas-prints'
    and public.fn_estou_ativo()
    and public.fn_meu_perfil() <> 'visualizador'
  );

drop policy if exists "reentregas_prints_delete" on storage.objects;
create policy "reentregas_prints_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'reentregas-prints'
    and public.fn_estou_ativo()
    and public.fn_meu_perfil() <> 'visualizador'
  );

-- ============================================================================
-- Fim da migration 0004.
-- ============================================================================
