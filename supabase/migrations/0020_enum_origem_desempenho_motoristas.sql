-- ============================================================================
-- 0020_enum_origem_desempenho_motoristas.sql
--
-- Adiciona o valor 'desempenho_motoristas' ao ENUM origem_importacao.
--
-- CONTEXTO:
--   O ENUM origem_importacao foi criado em 0007_importacao_arquivos.sql
--   com os valores: 'comprovei', 'rotina', 'funil_operacional', 'outro'.
--   A migration 0019 introduziu a origem 'desempenho_motoristas' no
--   frontend (importacoesService.js), mas não atualizou o ENUM — causando
--   o erro "invalid input value for enum origem_importacao" ao importar.
--
-- ABORDAGEM:
--   ALTER TYPE ... ADD VALUE IF NOT EXISTS é a forma canônica do PostgreSQL
--   para adicionar um valor a um ENUM existente sem recriar o tipo nem a
--   tabela, sem perda de dados e sem bloqueio de escrita nos dados já
--   gravados. IF NOT EXISTS torna a migration idempotente (segura para
--   ser executada mais de uma vez).
--
-- COMPATIBILIDADE:
--   - IF NOT EXISTS em ADD VALUE: disponível desde PostgreSQL 9.3
--   - Supabase utiliza PostgreSQL 15+ — totalmente compatível
--
-- VERIFICAÇÃO APÓS EXECUÇÃO:
--   select enumlabel
--   from pg_enum
--   join pg_type on pg_enum.enumtypid = pg_type.oid
--   where pg_type.typname = 'origem_importacao'
--   order by enumsortorder;
--
--   Resultado esperado:
--     comprovei
--     rotina
--     funil_operacional
--     outro
--     desempenho_motoristas
-- ============================================================================

alter type public.origem_importacao
  add value if not exists 'desempenho_motoristas';

-- ── Verificação embutida ──────────────────────────────────────────────────────
-- Confirma que o novo valor foi adicionado e que os valores originais
-- continuam presentes. Retorna uma linha por valor do ENUM.
select
  enumlabel                                  as valor,
  enumsortorder                              as ordem,
  case
    when enumlabel = 'desempenho_motoristas' then '← novo valor adicionado'
    else '← valor original preservado'
  end                                        as status
from pg_enum
join pg_type on pg_enum.enumtypid = pg_type.oid
where pg_type.typname = 'origem_importacao'
order by enumsortorder;
