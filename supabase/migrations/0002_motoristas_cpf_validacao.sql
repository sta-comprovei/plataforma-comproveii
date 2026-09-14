-- ============================================================================
-- TNS Gestão de Entregas — Migration 0002
-- Etapa 2: Cadastro de Motoristas
-- ============================================================================
-- Esta migration é INCREMENTAL e não destrutiva: apenas adiciona o que falta
-- à tabela `motoristas` já criada na migration 0001. Nenhuma coluna, tabela
-- ou política existente é removida — a tabela `operacoes` continua
-- referenciando `motoristas.id` sem qualquer alteração.
--
-- Como aplicar:
--   Supabase Dashboard → SQL Editor → cole este arquivo → Run
--   (ou `supabase db push`, que aplica as migrations em ordem)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Unicidade de código deve ser case-insensitive
-- ----------------------------------------------------------------------------
-- A constraint `unique` original em `motoristas.codigo` (migration 0001) é
-- case-sensitive: "ABC1" e "abc1" seriam aceitos como registros distintos
-- pelo Postgres. Como toda busca e validação no frontend usa comparação
-- case-insensitive (ilike), a fonte da verdade de unicidade precisa seguir
-- a mesma regra — caso contrário, dois cadastros simultâneos com
-- capitalização diferente poderiam burlar a validação client-side.
alter table public.motoristas drop constraint if exists motoristas_codigo_key;

drop index if exists idx_motoristas_codigo_ci_unique;
create unique index idx_motoristas_codigo_ci_unique
  on public.motoristas (lower(codigo));

-- ----------------------------------------------------------------------------
-- Coluna: CPF (opcional, mas único quando preenchido)
-- ----------------------------------------------------------------------------
alter table public.motoristas
  add column if not exists cpf text;

comment on column public.motoristas.cpf is 'CPF do motorista. Campo opcional; quando preenchido, deve ser único.';

-- Unicidade apenas para CPFs preenchidos (permite múltiplos NULL)
drop index if exists idx_motoristas_cpf_unique;
create unique index idx_motoristas_cpf_unique
  on public.motoristas (cpf)
  where cpf is not null and cpf <> '';

-- ----------------------------------------------------------------------------
-- Normalização e validação de CPF (armazenado só com dígitos)
-- ----------------------------------------------------------------------------
create or replace function public.fn_validar_cpf(p_cpf text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_cpf text;
  v_soma integer;
  v_resto integer;
  v_digito1 integer;
  v_digito2 integer;
  i integer;
begin
  v_cpf := regexp_replace(p_cpf, '[^0-9]', '', 'g');

  if length(v_cpf) <> 11 then
    return false;
  end if;

  -- Rejeita sequências repetidas (000.000.000-00, 111.111.111-11, etc.)
  if v_cpf ~ '^(\d)\1{10}$' then
    return false;
  end if;

  v_soma := 0;
  for i in 1..9 loop
    v_soma := v_soma + (substring(v_cpf, i, 1)::integer * (11 - i));
  end loop;
  v_resto := (v_soma * 10) % 11;
  if v_resto = 10 then v_resto := 0; end if;
  v_digito1 := v_resto;

  if v_digito1 <> substring(v_cpf, 10, 1)::integer then
    return false;
  end if;

  v_soma := 0;
  for i in 1..10 loop
    v_soma := v_soma + (substring(v_cpf, i, 1)::integer * (12 - i));
  end loop;
  v_resto := (v_soma * 10) % 11;
  if v_resto = 10 then v_resto := 0; end if;
  v_digito2 := v_resto;

  if v_digito2 <> substring(v_cpf, 11, 1)::integer then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.fn_validar_cpf is 'Valida dígitos verificadores de um CPF (apenas dígitos, sem máscara).';

create or replace function public.fn_motoristas_before_write()
returns trigger
language plpgsql
as $$
begin
  -- Código sempre normalizado (sem espaços nas pontas)
  new.codigo := trim(new.codigo);

  if new.codigo is null or new.codigo = '' then
    raise exception 'O código do motorista é obrigatório.';
  end if;

  -- Nome sempre normalizado
  new.nome := trim(new.nome);
  if new.nome is null or new.nome = '' then
    raise exception 'O nome do motorista é obrigatório.';
  end if;

  -- CPF: normaliza para somente dígitos; valida se preenchido
  if new.cpf is not null and trim(new.cpf) <> '' then
    new.cpf := regexp_replace(new.cpf, '[^0-9]', '', 'g');
    if not public.fn_validar_cpf(new.cpf) then
      raise exception 'CPF inválido.';
    end if;
  else
    new.cpf := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_motoristas_updated_at on public.motoristas;
drop trigger if exists trg_motoristas_before_write on public.motoristas;
create trigger trg_motoristas_before_write
  before insert or update on public.motoristas
  for each row execute function public.fn_motoristas_before_write();

-- ----------------------------------------------------------------------------
-- Índice para ordenação/pesquisa por nome (case-insensitive)
-- ----------------------------------------------------------------------------
create index if not exists idx_motoristas_nome_lower
  on public.motoristas (lower(nome));

-- (índice de pesquisa por código já coberto por idx_motoristas_codigo_ci_unique acima)

-- ============================================================================
-- As políticas de RLS de `motoristas` definidas na migration 0001
-- (select/insert/update para usuários ativos; delete apenas administrador)
-- já cobrem integralmente as operações desta etapa e permanecem inalteradas.
-- ============================================================================

-- ============================================================================
-- Fim da migration 0002. Nenhum dado fictício foi inserido.
-- ============================================================================
