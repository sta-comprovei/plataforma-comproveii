-- ============================================================================
-- Rastreamento de Reentrega — Migration 0003
-- Adiciona o perfil "visualizador" (somente leitura) ao enum perfil_usuario.
-- ============================================================================
-- IMPORTANTE — rode este arquivo SOZINHO (clique em "Run" só com este
-- conteúdo colado, sem juntar com o próximo arquivo).
--
-- O Postgres não permite usar um valor de enum recém-adicionado na MESMA
-- transação em que ele foi criado. Como o SQL Editor do Supabase roda o
-- texto colado como uma transação só, se este comando for colado junto com
-- a migration 0004 (que já USA 'visualizador' nas políticas de RLS), vai
-- dar o erro "unsafe use of new value of enum type". Por isso são dois
-- arquivos separados — rode este primeiro, espere terminar, depois rode o
-- 0004_perfil_visualizador_rls.sql em outra execução.
-- ============================================================================

alter type perfil_usuario add value if not exists 'visualizador';

-- ============================================================================
-- Fim da migration 0003. Agora rode 0004_perfil_visualizador_rls.sql.
-- ============================================================================
