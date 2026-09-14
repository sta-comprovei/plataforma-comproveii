import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { IconBot, IconAlertCircle } from '../components/ui/Icons'
import Button from '../components/ui/Button'
import './AssistenteIA.css'

// ─────────────────────────────────────────────────────────────────────────────
// Exemplos prontos por categoria
// ─────────────────────────────────────────────────────────────────────────────
const EXEMPLOS = [
  {
    grupo: '📋 Operação do Dia',
    perguntas: [
      'Quais operações estão em andamento hoje?',
      'Qual motorista tem o maior lead time esta semana?',
      'Liste as operações pendentes de hoje com rota e motorista.',
      'Quantas operações foram concluídas hoje por tipo (DF, Adega, Filial)?',
    ],
  },
  {
    grupo: '🚚 Motoristas',
    perguntas: [
      'Qual motorista teve mais divergências no último mês?',
      'Liste os 5 motoristas com maior percentual de conclusão.',
      'Quais motoristas estão sem atualização no COMPROVEI hoje?',
      'Me dê o histórico de operações do último mês de um motorista específico.',
    ],
  },
  {
    grupo: '📍 Rotas',
    perguntas: [
      'Qual rota tem o maior tempo médio de transporte?',
      'Quantas entregas foram realizadas para a rota principal este mês?',
      'Liste as rotas com SLA abaixo de 80% no último mês.',
      'Qual rota teve mais divergências de NF este mês?',
    ],
  },
  {
    grupo: '⏱ SLA e Gargalos',
    perguntas: [
      'Qual o percentual de SLA dentro do prazo por rota este mês?',
      'Qual etapa operacional tem o maior tempo médio de atraso?',
      'Mostre o gargalo principal entre faturamento e WMS.',
      'Quantos pedidos estão com SLA vermelho hoje?',
    ],
  },
  {
    grupo: '⚠️ Divergências e Alertas',
    perguntas: [
      'Há divergências de NF entre ROTINA e COMPROVEI hoje?',
      'Quais motoristas aparecem no COMPROVEI sem operação registrada?',
      'Liste os alertas críticos abertos.',
      'Quantas pendências foram detectadas hoje?',
    ],
  },
  {
    grupo: '📊 Análises gerais',
    perguntas: [
      'Resuma o desempenho operacional desta semana.',
      'Qual foi o mês com maior número de divergências?',
      'Compare o lead time médio de DF, Adega e Filial.',
      'Quantos comunicados ficaram sem resolução nos últimos 7 dias?',
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Contexto de dados reais — busca compacta do banco para enriquecer o prompt
// ─────────────────────────────────────────────────────────────────────────────
async function coletarContextoBanco() {
  const hoje = new Date().toISOString().slice(0, 10)

  const [resOps, resAlerta, resPend, resComp, resDesempenho, resLixeira, resUsuarios, resSLA] = await Promise.allSettled([
    supabase.from('operacoes')
      .select('nome_motorista, tipo_operacao, rota, status, lead_time_min, divergencia, data_operacao')
      .eq('data_operacao', hoje)
      .eq('ativa', true)
      .limit(50),

    supabase.from('alertas_operacionais')
      .select('tipo, severidade, motorista, rota, descricao')
      .eq('resolvido', false)
      .order('criado_em', { ascending: false })
      .limit(20),

    supabase.from('comunicados_operacionais')
      .select('tipo, motorista, rota, descricao, data_operacao')
      .eq('resolvido', false)
      .limit(20),

    supabase.from('registros_comprovei')
      .select('motorista, cidade_destino, status_entrega, data_rota')
      .gte('data_rota', hoje)
      .limit(30),

    // Desempenho dos motoristas — mês mais recente (top 20 por qualidade)
    supabase.from('vw_ranking_desempenho')
      .select('nome_motorista, qualidade_pct, variacao_qualidade, competencia')
      .order('qualidade_pct', { ascending: false })
      .limit(20),

    // Lixeira — itens recentes
    supabase.from('lixeira')
      .select('tabela_origem, descricao, usuario_exclusao, data_exclusao')
      .order('data_exclusao', { ascending: false })
      .limit(10),

    // Usuários ativos do sistema
    supabase.from('usuarios')
      .select('nome, email, perfil, ativo')
      .eq('ativo', true)
      .limit(30),

    // SLA por rota — vw_lead_time_por_rota (migration 0026)
    supabase.from('vw_lead_time_por_rota')
      .select('rota, media_min, prazo_efetivo_min, eficiencia_pct, situacao, diferenca_min, total_viagens, fonte_prazo')
      .order('diferenca_min', { ascending: false })
      .limit(30),
  ])

  const ops        = resOps.value?.data        ?? []
  const alert      = resAlerta.value?.data     ?? []
  const pend       = resPend.value?.data       ?? []
  const comp       = resComp.value?.data       ?? []
  const desempenho = resDesempenho.value?.data ?? []
  const lixeira    = resLixeira.value?.data    ?? []
  const usuarios   = resUsuarios.value?.data   ?? []
  const slaRotas   = resSLA.value?.data        ?? []

  return [
    `Data atual: ${hoje}.`,
    `Operações hoje (${ops.length}): ${ops.map(o => `${o.nome_motorista}/${o.tipo_operacao}/${o.rota}/${o.status}`).join(' | ') || 'nenhuma'}`,
    `Alertas abertos (${alert.length}): ${alert.map(a => `[${a.severidade}]${a.tipo}/${a.motorista}`).join(' | ') || 'nenhum'}`,
    `Comunicados pendentes (${pend.length}): ${pend.map(p => `${p.tipo}/${p.motorista}`).join(' | ') || 'nenhum'}`,
    `COMPROVEI hoje (${comp.length} registros): ${comp.map(c => `${c.motorista}→${c.cidade_destino}:${c.status_entrega}`).join(' | ') || 'nenhum'}`,
    `Desempenho motoristas (${desempenho.length} no ranking): ${desempenho.map(d => `${d.nome_motorista}:${d.qualidade_pct}%${d.variacao_qualidade != null ? `(${d.variacao_qualidade > 0 ? '+' : ''}${d.variacao_qualidade}%)` : ''}`).join(' | ') || 'nenhum dado importado'}`,
    `Lixeira (${lixeira.length} itens recentes): ${lixeira.map(l => `${l.tabela_origem}:${l.descricao?.slice(0,40)} por ${l.usuario_exclusao}`).join(' | ') || 'vazia'}`,
    `Usuários ativos (${usuarios.length}): ${usuarios.map(u => `${u.nome}[${u.perfil}]`).join(' | ') || 'nenhum'}`,
    `SLA por rota (top 30, ordenado por atraso): ${slaRotas.length > 0 ? slaRotas.map(r => `${r.rota}|LT:${r.media_min!=null?Math.round(r.media_min/60*10)/10+'h':'?'}|Prazo:${r.prazo_efetivo_min!=null?Math.round(r.prazo_efetivo_min/60*10)/10+'h':'sem prazo'}|Efic:${r.eficiencia_pct!=null?r.eficiencia_pct+'%':'?'}|${r.situacao}|${r.fonte_prazo}`).join(' | ') : 'sem dados (vw_lead_time_por_rota não retornou registros — verifique migration 0026)'}`,
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente de mensagem
// ─────────────────────────────────────────────────────────────────────────────
function Mensagem({ msg }) {
  const ehAssistente = msg.role === 'assistant'
  return (
    <div className={`ia-msg ia-msg-${msg.role}`}>
      <div className="ia-msg-avatar">
        {ehAssistente ? '🤖' : '👤'}
      </div>
      <div className="ia-msg-balao">
        {msg.content.split('\n').map((linha, i) => (
          <p key={i} style={{ margin: i > 0 ? '6px 0 0' : 0 }}>{linha}</p>
        ))}
        {msg.carregando && <span className="ia-typing">▌</span>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA
// ─────────────────────────────────────────────────────────────────────────────
export default function AssistenteIA() {
  const { perfil } = useAuth()
  const isGestor = perfil === 'gestor'

  const [mensagens, setMensagens] = useState([
    {
      role: 'assistant',
      content: 'Olá! Sou o Assistente Operacional da TNS. Tenho acesso aos dados reais do banco — operações de hoje, alertas, comunicados, registros do COMPROVEI, SLA e gargalos.\n\nComo posso ajudar?',
    },
  ])
  const [input, setInput]         = useState('')
  const [enviando, setEnviando]   = useState(false)
  const [erro, setErro]           = useState('')
  const [grupoAberto, setGrupo]   = useState(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)

  // Rolar para o fim quando nova mensagem chega
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [mensagens])

  const enviar = useCallback(async (texto) => {
    const pergunta = (texto || input).trim()
    if (!pergunta || enviando) return

    setInput('')
    setErro('')
    setEnviando(true)

    const novaMsgUser = { role: 'user', content: pergunta }
    const placeholder = { role: 'assistant', content: '', carregando: true }
    setMensagens(prev => [...prev, novaMsgUser, placeholder])

    try {
      // Coletar contexto real do banco
      const contexto = await coletarContextoBanco()

      // Histórico para o modelo (últimas 8 mensagens sem placeholder)
      const historico = mensagens
        .filter(m => !m.carregando)
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }))

      // Payload enviado para a Edge Function (chave fica no servidor)
      const payload = {
        model:      'claude-sonnet-4-6',
        max_tokens: 1000,
        system:     `Você é o Assistente Operacional da TNS Gestão de Entregas — plataforma logística que gerencia motoristas, rotas e entregas.

CONTEXTO REAL DO BANCO (atualizado agora):
${contexto}

INSTRUÇÕES:
- Responda sempre em português brasileiro.
- Use os dados do contexto quando relevantes.
- Para análises históricas que não estão no contexto, informe que pode ser necessário consultar filtros avançados.
- Seja direto e objetivo. Prefira listas quando há múltiplos itens.
- Não invente dados. Se não tiver a informação, diga claramente.
- Categorias de operação: DF (entregas urbanas, horas), Adega (especial, horas), Filial (interestadual, dias).${isGestor ? `

PERFIL DO USUÁRIO: GESTOR (somente consulta)
RESTRIÇÕES ABSOLUTAS: Você NUNCA pode sugerir, executar ou descrever ações que alterem dados. Não pode criar, editar, excluir ou importar registros. Se solicitado, informe que o perfil Gestor é apenas de consulta e a ação deve ser feita por um Administrador.` : ''}`,
        messages: [...historico, { role: 'user', content: pergunta }],
      }

      // Invocar Edge Function — ANTHROPIC_API_KEY nunca sai do servidor
      const { data: fnData, error: fnError } = await supabase.functions.invoke('assistente-ia', {
        body: payload,
      })
      if (fnError) throw new Error(fnError.message || 'Erro na Edge Function')
      if (fnData?.erro) throw new Error(fnData.erro)

      const resposta = fnData?.content?.find((b) => b.type === 'text')?.text || 'Sem resposta.'

      setMensagens(prev => {
        const sem = prev.filter(m => !m.carregando)
        return [...sem, { role: 'assistant', content: resposta }]
      })
    } catch (e) {
      setMensagens(prev => prev.filter(m => !m.carregando))
      setErro(`Erro ao consultar o assistente: ${e.message}`)
    } finally {
      setEnviando(false)
      inputRef.current?.focus()
    }
  }, [input, enviando, mensagens])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  function limpar() {
    setMensagens([{
      role: 'assistant',
      content: 'Conversa reiniciada. Como posso ajudar?',
    }])
    setErro('')
  }

  return (
    <div className="ia-page">
      {/* Header */}
      <div className="ia-header">
        <div className="ia-header-left">
          <div className="ia-header-icon"><IconBot width={22} height={22} /></div>
          <div>
            <h2>Assistente IA</h2>
            <p>Consultas em linguagem natural com dados reais do banco</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={limpar}>Limpar conversa</Button>
      </div>

      <div className="ia-layout">
        {/* Exemplos — coluna lateral */}
        <div className="ia-exemplos">
          <div className="ia-exemplos-titulo">Exemplos prontos</div>
          {EXEMPLOS.map((g, gi) => (
            <div key={gi} className="ia-grupo">
              <button
                type="button"
                className="ia-grupo-label"
                onClick={() => setGrupo(grupoAberto === gi ? null : gi)}
              >
                {g.grupo}
                <span style={{ marginLeft: 'auto', fontSize: 10 }}>{grupoAberto === gi ? '▲' : '▼'}</span>
              </button>
              {grupoAberto === gi && (
                <div className="ia-grupo-pergs">
                  {g.perguntas.map((p, pi) => (
                    <button
                      key={pi}
                      type="button"
                      className="ia-perg-btn"
                      onClick={() => enviar(p)}
                      disabled={enviando}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Chat — área principal */}
        <div className="ia-chat">
          {/* Mensagens */}
          <div className="ia-msg-list" ref={listRef}>
            {mensagens.map((m, i) => <Mensagem key={i} msg={m} />)}
          </div>

          {/* Erro */}
          {erro && (
            <div className="ia-erro">
              <IconAlertCircle width={14} height={14} /> {erro}
            </div>
          )}

          {/* Input */}
          <div className="ia-input-area">
            <textarea
              ref={inputRef}
              className="ia-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte sobre operações, motoristas, rotas, SLA, divergências…"
              rows={2}
              disabled={enviando}
            />
            <button
              type="button"
              className="ia-send-btn"
              onClick={() => enviar()}
              disabled={enviando || !input.trim()}
            >
              {enviando ? '⏳' : '➤'}
            </button>
          </div>
          <div className="ia-input-hint">Enter para enviar · Shift+Enter para nova linha</div>
        </div>
      </div>
    </div>
  )
}
