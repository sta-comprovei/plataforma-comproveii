-- ============================================================================
-- TNS Gestão de Entregas — Migration 0006
-- Etapa 5: Histórico Operacional
-- ============================================================================
-- Esta migration reativa a movimentação automática de operações para o
-- "Histórico", que a migration 0004 (Etapa 3) havia deliberadamente
-- desativado — o próprio comentário daquela migration já antecipava que
-- isso seria implementado "em etapa posterior". Esta é essa etapa.
--
-- Regra de finalização (conforme requisito da Etapa 5):
--   Uma operação é considerada FINALIZADA quando possuir simultaneamente:
--     - data_finalizacao preenchida
--     - hora_finalizacao preenchida
--     - status IN ('Entrega finalizada', 'Concluído')
--   Operações finalizadas saem da tela "Operação do Dia" (ativa = false)
--   e passam a aparecer no "Histórico Operacional" — sem nenhuma tabela
--   nova: o Histórico é uma VISÃO FILTRADA da mesma tabela `operacoes`
--   (ativa = false), preservando o registro original e todo o seu
--   histórico de auditoria já existente em `historico_auditoria`.
--
-- Operações com status Pendente, Em trânsito ou Chegada ao cliente
-- permanecem em "Operação do Dia" (ativa = true) independentemente de
-- quantos dias tenham se passado desde o início — nenhuma lógica de
-- tempo/expiração é aplicada, apenas a condição de status + finalização
-- acima.
--
-- Esta migration é incremental e não-destrutiva: não cria nem remove
-- nenhuma tabela. Apenas restaura a lógica de `ativa` no trigger BEFORE
-- WRITE de `operacoes` (já existente desde a migration 0001) e faz o
-- backfill necessário para que operações JÁ EXISTENTES no banco sejam
-- reclassificadas corretamente, não apenas escritas futuras.
--
-- Como aplicar:
--   Supabase Dashboard → SQL Editor → cole este arquivo → Run
--   (ou `supabase db push`, que aplica as migrations em ordem)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Substitui a função de trigger: restaura a lógica de `ativa`, usando os
-- nomes de coluna corretos pós-Etapa-3 (data_finalizacao/hora_finalizacao,
-- não os antigos dt_fim/hr_fim da migration 0001 original).
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

  -- ETAPA 5: regra de movimentação para o Histórico Operacional.
  -- ativa = false (sai de "Operação do Dia", aparece no Histórico) quando
  -- TODAS as condições abaixo são verdadeiras simultaneamente:
  --   1. status indica conclusão ('Entrega finalizada' ou 'Concluído')
  --   2. data_finalizacao está preenchida
  --   3. hora_finalizacao está preenchida
  -- Qualquer outra combinação (Pendente / Em trânsito / Chegada ao
  -- cliente, OU status de conclusão sem data/hora de fim ainda
  -- preenchidas) mantém ativa = true, permanecendo em "Operação do Dia"
  -- — inclusive operações iniciadas há vários dias atrás.
  if new.status in ('Entrega finalizada', 'Concluído')
     and new.data_finalizacao is not null
     and new.hora_finalizacao is not null then
    new.ativa := false;
  else
    new.ativa := true;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function public.fn_operacoes_before_write() is
  'Calcula lead_time_min, preenche usuario_criacao/usuario_ultima_alteracao e classifica ativa (Operação do Dia) vs. histórico (Etapa 5: status de conclusão + data/hora de finalização preenchidas).';

comment on column public.operacoes.ativa is 'true = aparece em "Operação do Dia" (Pendente/Em trânsito/Chegada ao cliente, ou conclusão ainda sem data/hora de fim); false = finalizada, aparece no Histórico Operacional.';

-- ----------------------------------------------------------------------------
-- Backfill: reclassifica APENAS as operações cuja classificação `ativa`
-- realmente muda sob a nova regra. Sem este passo, registros já
-- finalizados antes desta migration ficariam com ativa=true "congelado"
-- da regra antiga (Etapa 3), só seriam corrigidos na próxima edição
-- manual de cada um.
--
-- O WHERE abaixo é cirúrgico — só dispara o trigger BEFORE UPDATE (que
-- recalcula `ativa`) nas linhas onde o novo valor calculado realmente
-- difere do valor atualmente armazenado. Isso evita gerar centenas de
-- entradas "ruído" em historico_auditoria (uma por linha) para
-- operações que já estavam corretamente classificadas, mantendo a
-- trilha de auditoria gerada por este backfill limpa e significativa:
-- cada entrada resultante representa uma mudança real de classificação
-- (tipicamente: operações finalizadas que estavam erroneamente
-- aparecendo em "Operação do Dia" e passam corretamente para o
-- Histórico).
update public.operacoes
set updated_at = updated_at -- no-op proposital sobre o dado de negócio: dispara o trigger
where (
  status in ('Entrega finalizada', 'Concluído')
  and data_finalizacao is not null
  and hora_finalizacao is not null
) is distinct from (ativa = false);

-- ============================================================================
-- As políticas de RLS de `operacoes` definidas na migration 0001
-- (select/insert/update para qualquer usuário ativo; delete apenas
-- administrador) já cobrem o Histórico Operacional sem nenhuma alteração
-- — é a mesma tabela, apenas filtrada por `ativa = false` no frontend.
-- ============================================================================

-- ============================================================================
-- Fim da migration 0006. Nenhum dado fictício foi inserido ou alterado em
-- conteúdo de negócio — apenas a classificação ativa/histórico de
-- registros já existentes foi recalculada.
-- ============================================================================
