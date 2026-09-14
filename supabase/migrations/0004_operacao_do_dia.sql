-- ============================================================================
-- TNS Gestão de Entregas — Migration 0004
-- Etapa 3: Operação do Dia
-- ============================================================================
-- Esta migration ajusta a tabela `operacoes` (criada na migration 0001) para
-- a nomenclatura exata pedida na Etapa 3, adiciona as colunas que faltavam
-- (snapshot de código/nome do motorista, usuário de criação/última
-- alteração) e MUDA a regra de visibilidade: nesta etapa, operações
-- finalizadas DEVEM continuar aparecendo na tela "Operação do Dia" — a
-- movimentação para o Histórico fica para uma etapa futura. A trigger
-- antiga que escondia operações concluídas é removida.
--
-- Esta migration é incremental: usa `alter table ... rename column` (não
-- recria a tabela), preservando toda referência existente em
-- historico_auditoria a registros já criados nas etapas anteriores.
--
-- Como aplicar:
--   Supabase Dashboard → SQL Editor → cole este arquivo → Run
--   (ou `supabase db push`, que aplica as migrations em ordem)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Renomeia colunas para a nomenclatura definida na Etapa 3
-- ----------------------------------------------------------------------------
alter table public.operacoes rename column data to data_operacao;
alter table public.operacoes rename column previstas to entregas_previstas;
alter table public.operacoes rename column realizadas to entregas_realizadas;
alter table public.operacoes rename column percentual to percentual_conclusao;
alter table public.operacoes rename column dt_inicio to data_inicio;
alter table public.operacoes rename column hr_inicio to hora_inicio;
alter table public.operacoes rename column dt_fim to data_finalizacao;
alter table public.operacoes rename column hr_fim to hora_finalizacao;
alter table public.operacoes rename column created_by to usuario_criacao;

-- ----------------------------------------------------------------------------
-- Novas colunas pedidas pela Etapa 3
-- ----------------------------------------------------------------------------

-- Snapshot do código/nome do motorista no momento da operação: mesmo que o
-- cadastro do motorista mude depois (ex.: nome corrigido) ou seja
-- inativado, a operação histórica continua mostrando os dados de quando
-- foi registrada. motorista_id continua existindo como FK para a relação
-- "viva" (perfil do motorista, filtros, etc.).
alter table public.operacoes
  add column if not exists codigo_motorista text,
  add column if not exists nome_motorista text,
  add column if not exists usuario_ultima_alteracao uuid references public.usuarios(id) on delete set null;

comment on column public.operacoes.codigo_motorista is 'Código do motorista no momento da operação (snapshot, não muda se o cadastro do motorista for editado depois).';
comment on column public.operacoes.nome_motorista is 'Nome do motorista no momento da operação (snapshot).';
comment on column public.operacoes.usuario_criacao is 'Usuário que criou o registro da operação. Preenchido automaticamente via trigger a partir de auth.uid() — nunca enviado pelo frontend.';
comment on column public.operacoes.usuario_ultima_alteracao is 'Usuário que fez a última edição no registro da operação. Atualizado automaticamente via trigger a cada escrita.';

-- Backfill: para operações já existentes (criadas nas etapas anteriores,
-- se houver), preenche o snapshot a partir do cadastro atual do motorista.
update public.operacoes o
set codigo_motorista = m.codigo,
    nome_motorista = m.nome
from public.motoristas m
where o.motorista_id = m.id
  and o.codigo_motorista is null;

alter table public.operacoes
  alter column codigo_motorista set not null,
  alter column nome_motorista set not null;

-- ----------------------------------------------------------------------------
-- Renomeia índices para acompanhar os novos nomes de coluna
-- ----------------------------------------------------------------------------
drop index if exists idx_operacoes_data;
create index if not exists idx_operacoes_data_operacao on public.operacoes (data_operacao);

-- Índices adicionais para os filtros pedidos na Etapa 3 (rota, placa,
-- motorista por código — além dos já existentes por motorista_id/tipo/status)
create index if not exists idx_operacoes_rota on public.operacoes (lower(rota));
create index if not exists idx_operacoes_placa on public.operacoes (lower(placa));
create index if not exists idx_operacoes_codigo_motorista on public.operacoes (codigo_motorista);

-- ----------------------------------------------------------------------------
-- Substitui a trigger de escrita: mantém o cálculo de lead time, mas
-- REMOVE a lógica que escondia operações finalizadas da tela operacional
-- (coluna `ativa` deixa de ser usada para esse fim nesta etapa — ver nota
-- abaixo). O percentual_conclusao já é uma coluna gerada (generated
-- always as ...), recalculada automaticamente pelo Postgres a cada
-- escrita; nenhuma lógica adicional é necessária para isso.
-- ----------------------------------------------------------------------------
create or replace function public.fn_operacoes_before_write()
returns trigger
language plpgsql
as $$
declare
  v_motorista record;
begin
  -- Validação de defesa em profundidade (somente na CRIAÇÃO da operação):
  -- o frontend já impede salvar com motorista inexistente/inativo, mas a
  -- regra é reforçada aqui para que nenhuma chamada direta à API consiga
  -- burlá-la. Aplicada apenas a INSERT — uma operação já em andamento não
  -- deve ficar travada para edição/finalização caso o motorista seja
  -- inativado depois que a operação foi criada.
  if (tg_op = 'INSERT') then
    select codigo, nome, ativo into v_motorista
    from public.motoristas
    where id = new.motorista_id;

    if v_motorista is null then
      raise exception 'Motorista não cadastrado.';
    end if;

    if not v_motorista.ativo then
      raise exception 'Não é possível criar uma operação para um motorista inativo.';
    end if;
  end if;

  -- Lead time só existe quando início e fim estão completos
  if new.data_inicio is not null and new.hora_inicio is not null
     and new.data_finalizacao is not null and new.hora_finalizacao is not null then
    new.lead_time_min := greatest(
      0,
      round(
        extract(
          epoch from (
            (new.data_finalizacao + new.hora_finalizacao) - (new.data_inicio + new.hora_inicio)
          )
        ) / 60
      )
    );
  else
    new.lead_time_min := null;
  end if;

  -- usuario_criacao/usuario_ultima_alteracao são preenchidos a partir do
  -- usuário autenticado no momento da escrita — o frontend não precisa
  -- (e não deve) enviar esses valores manualmente, evitando que um
  -- usuário se passe por outro.
  if (tg_op = 'INSERT') then
    new.usuario_criacao := auth.uid();
  end if;
  new.usuario_ultima_alteracao := auth.uid();

  -- Nesta etapa, TODA operação permanece visível na tela "Operação do Dia"
  -- (Pendente, Em trânsito, Chegada ao cliente, Entrega finalizada e
  -- Concluído aparecem igualmente). A coluna `ativa` é mantida na tabela
  -- por compatibilidade e uso futuro (quando a movimentação automática
  -- para o Histórico for implementada em etapa posterior), mas sempre
  -- gravada como true a partir de agora — não influencia mais a
  -- visibilidade da listagem.
  new.ativa := true;

  new.updated_at := now();
  return new;
end;
$$;

comment on function public.fn_operacoes_before_write() is
  'Calcula lead_time_min automaticamente. A partir da Etapa 3, NÃO esconde operações finalizadas da tela operacional — todas permanecem visíveis até que uma etapa futura implemente a movimentação explícita para o Histórico.';

-- (o trigger trg_operacoes_before_write já existe desde a migration 0001 e
-- continua válido — apenas a função por trás dele foi substituída acima)

-- ----------------------------------------------------------------------------
-- Anexa o trigger genérico de auditoria (mesmo padrão de motoristas/usuarios)
-- ----------------------------------------------------------------------------
drop trigger if exists trg_auditoria_operacoes on public.operacoes;
create trigger trg_auditoria_operacoes
  after insert or update or delete on public.operacoes
  for each row execute function public.fn_registrar_auditoria();

-- ----------------------------------------------------------------------------
-- ROTULOS_TABELA no frontend (src/lib/auditoriaService.js) já mapeia
-- 'operacoes' → 'Operação do Dia' desde a Etapa 2 — nenhuma alteração
-- necessária ali.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- As políticas de RLS de `operacoes` definidas na migration 0001
-- (select/insert/update para qualquer usuário ativo — administrador e
-- operador; delete apenas administrador) já atendem exatamente às
-- permissões pedidas na Etapa 3 e permanecem inalteradas.
-- ============================================================================

-- ============================================================================
-- Fim da migration 0004. Nenhum dado fictício foi inserido.
-- ============================================================================
