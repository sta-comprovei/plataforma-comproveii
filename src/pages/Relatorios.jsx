import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buscarOperacoesRelatorio,
  calcularRelatorioOperacional,
  calcularRelatorioMotoristas,
  calcularRelatorioDivergencias,
  TIPOS_OPERACAO,
} from '../lib/relatoriosService'
import { listarMotoristas } from '../lib/motoristasService'
import ExportButtons from '../components/ui/ExportButtons'
import Button from '../components/ui/Button'
import { IconFileText, IconAlertCircle } from '../components/ui/Icons'
import './Relatorios.css'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function hoje() {
  return new Date().toISOString().slice(0, 10)
}
function subtrairDias(dias) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}
function inicioMes() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function inicioSemana() {
  const d = new Date()
  const dia = d.getDay()
  d.setDate(d.getDate() - dia)
  return d.toISOString().slice(0, 10)
}
function fmtData(iso) {
  if (!iso) return '—'
  const [a, m, dia] = iso.split('-')
  return `${dia}/${m}/${a}`
}
function fmtMin(min) {
  if (min === null || min === undefined) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}min`
  return `${m}min`
}
function pct(val, total) {
  return total > 0 ? Math.round((val / total) * 100) : 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Aba: selector
// ─────────────────────────────────────────────────────────────────────────────
const ABAS = [
  { id: 'diario',     label: 'Diário'           },
  { id: 'semanal',    label: 'Semanal'          },
  { id: 'mensal',     label: 'Mensal'           },
  { id: 'motorista',  label: 'Por Motorista'    },
  { id: 'rota',       label: 'Por Rota'         },
  { id: 'divergencia',label: 'Divergências'     },
]

function periodoParaAba(aba) {
  switch (aba) {
    case 'diario':     return { dataInicio: hoje(),       dataFim: hoje() }
    case 'semanal':    return { dataInicio: inicioSemana(),dataFim: hoje() }
    case 'mensal':     return { dataInicio: inicioMes(),   dataFim: hoje() }
    default:           return { dataInicio: subtrairDias(30), dataFim: hoje() }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes de tabela
// ─────────────────────────────────────────────────────────────────────────────
function BadgeStatus({ status }) {
  const cores = {
    'Concluído':          'rel-badge-green',
    'Entrega finalizada': 'rel-badge-blue',
    'Em trânsito':        'rel-badge-amber',
    'Chegada ao cliente': 'rel-badge-amber',
    'Pendente':           'rel-badge-gray',
  }
  return <span className={`rel-badge ${cores[status] || 'rel-badge-gray'}`}>{status}</span>
}

function BadgeTipo({ tipo }) {
  const cls = { DF: 'rel-badge-df', Adega: 'rel-badge-adega', Filial: 'rel-badge-filial' }
  return <span className={`rel-badge ${cls[tipo] || 'rel-badge-gray'}`}>{tipo}</span>
}

function PctBar({ val, max = 100, cor = '#F97316' }) {
  const w = max > 0 ? Math.min(100, (val / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="rel-bar-track">
        <div className="rel-bar-fill" style={{ width: `${w}%`, background: cor }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, minWidth: 36, color: cor }}>{val}%</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Aba Diário / Semanal / Mensal — tabela geral + KPIs
// ─────────────────────────────────────────────────────────────────────────────
function AbaGeral({ operacoes, titulo }) {
  const kpi = useMemo(() => calcularRelatorioOperacional(operacoes), [operacoes])

  const COLUNAS_EXPORT = [
    { chave: 'data_operacao',       rotulo: 'Data'       },
    { chave: 'nome_motorista',      rotulo: 'Motorista'  },
    { chave: 'codigo_motorista',    rotulo: 'Código'     },
    { chave: 'tipo_operacao',       rotulo: 'Tipo'       },
    { chave: 'rota',                rotulo: 'Rota'       },
    { chave: 'placa',               rotulo: 'Placa'      },
    { chave: 'entregas_previstas',  rotulo: 'Previstas'  },
    { chave: 'entregas_realizadas', rotulo: 'Realizadas' },
    { chave: 'percentual_conclusao',rotulo: '% Conc.'    },
    { chave: 'lead_time_min',       rotulo: 'Lead Time'  },
    { chave: 'status',              rotulo: 'Status'     },
    { chave: 'divergencia',         rotulo: 'Divergência'},
  ]

  const linhasExport = operacoes.map(o => ({
    ...o,
    data_operacao: fmtData(o.data_operacao),
    lead_time_min: fmtMin(o.lead_time_min),
  }))

  return (
    <>
      <div className="rel-kpi-row">
        <div className="rel-kpi"><div className="rel-kpi-val">{kpi.total}</div><div className="rel-kpi-lbl">Total</div></div>
        <div className="rel-kpi"><div className="rel-kpi-val" style={{ color: 'var(--green)' }}>{kpi.concluidas}</div><div className="rel-kpi-lbl">Concluídas</div></div>
        <div className="rel-kpi"><div className="rel-kpi-val" style={{ color: 'var(--amber)' }}>{kpi.emAndamento}</div><div className="rel-kpi-lbl">Em andamento</div></div>
        <div className="rel-kpi"><div className="rel-kpi-val" style={{ color: 'var(--text3)' }}>{kpi.pendentes}</div><div className="rel-kpi-lbl">Pendentes</div></div>
        <div className="rel-kpi"><div className="rel-kpi-val" style={{ color: 'var(--red)' }}>{kpi.comDivergencia}</div><div className="rel-kpi-lbl">Divergências</div></div>
        <div className="rel-kpi"><div className="rel-kpi-val" style={{ color: 'var(--orange)' }}>{pct(kpi.concluidas, kpi.total)}%</div><div className="rel-kpi-lbl">Conclusão</div></div>
      </div>

      <div className="rel-card">
        <div className="rel-card-hdr">
          <span className="rel-card-title">Operações — {titulo}</span>
          <ExportButtons colunas={COLUNAS_EXPORT} linhas={linhasExport} nomeArquivo={`relatorio-${titulo.toLowerCase()}`} titulo={`Relatório ${titulo}`} />
        </div>
        <div className="rel-tbl-wrap">
          <table className="rel-tbl">
            <thead>
              <tr>
                <th>Data</th><th>Motorista</th><th>Tipo</th><th>Rota</th>
                <th>Placa</th><th>Prev.</th><th>Real.</th><th>%</th>
                <th>Lead Time</th><th>Status</th><th>Divergência</th>
              </tr>
            </thead>
            <tbody>
              {operacoes.slice(0, 500).map(o => (
                <tr key={o.id}>
                  <td className="rel-dim">{fmtData(o.data_operacao)}</td>
                  <td style={{ fontWeight: 500 }}>{o.nome_motorista}</td>
                  <td><BadgeTipo tipo={o.tipo_operacao} /></td>
                  <td>{o.rota || '—'}</td>
                  <td className="rel-mono">{o.placa || '—'}</td>
                  <td className="rel-num">{o.entregas_previstas ?? '—'}</td>
                  <td className="rel-num">{o.entregas_realizadas ?? '—'}</td>
                  <td className="rel-num" style={{ color: (o.percentual_conclusao ?? 0) >= 90 ? 'var(--green)' : 'var(--amber)', fontWeight: 700 }}>
                    {o.percentual_conclusao ?? '—'}%
                  </td>
                  <td className="rel-num" style={{ color: 'var(--text2)' }}>{fmtMin(o.lead_time_min)}</td>
                  <td><BadgeStatus status={o.status} /></td>
                  <td style={{ fontSize: 12, color: o.divergencia ? 'var(--red)' : 'var(--text4)' }}>
                    {o.divergencia || '—'}
                  </td>
                </tr>
              ))}
              {operacoes.length === 0 && (
                <tr><td colSpan={11} className="rel-vazio">Nenhuma operação encontrada para este período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {operacoes.length > 500 && (
          <div className="rel-nota">Exibindo 500 de {operacoes.length} registros. Use Exportar para ver todos.</div>
        )}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Aba Por Motorista
// ─────────────────────────────────────────────────────────────────────────────
function AbaMotorista({ operacoes }) {
  const resumo = useMemo(() => calcularRelatorioMotoristas(operacoes), [operacoes])
    .sort((a, b) => b.quantidade - a.quantidade)

  const COLS = [
    { chave: 'nome',               rotulo: 'Motorista'       },
    { chave: 'codigo',             rotulo: 'Código'          },
    { chave: 'quantidade',         rotulo: 'Operações'       },
    { chave: 'concluidas',         rotulo: 'Concluídas'      },
    { chave: 'pendentes',          rotulo: 'Pendentes'       },
    { chave: 'percentualConclusao',rotulo: '% Conclusão'     },
    { chave: 'leadTimeMedio',      rotulo: 'Lead Time Médio' },
  ]
  const linhas = resumo.map(r => ({ ...r, leadTimeMedio: fmtMin(r.leadTimeMedio) }))

  return (
    <div className="rel-card">
      <div className="rel-card-hdr">
        <span className="rel-card-title">Desempenho por Motorista</span>
        <ExportButtons colunas={COLS} linhas={linhas} nomeArquivo="relatorio-por-motorista" titulo="Relatório por Motorista" />
      </div>
      <div className="rel-tbl-wrap">
        <table className="rel-tbl">
          <thead>
            <tr>
              <th>#</th><th>Motorista</th><th>Código</th><th>Operações</th>
              <th>Concluídas</th><th>% Conclusão</th><th>Lead Time Médio</th>
            </tr>
          </thead>
          <tbody>
            {resumo.map((m, i) => (
              <tr key={m.motoristaId}>
                <td className="rel-dim" style={{ fontWeight: 700 }}>{i + 1}</td>
                <td style={{ fontWeight: 500 }}>{m.nome}</td>
                <td className="rel-mono">{m.codigo}</td>
                <td className="rel-num">{m.quantidade}</td>
                <td className="rel-num" style={{ color: 'var(--green)' }}>{m.concluidas}</td>
                <td style={{ minWidth: 120 }}><PctBar val={m.percentualConclusao} /></td>
                <td className="rel-num">{fmtMin(m.leadTimeMedio)}</td>
              </tr>
            ))}
            {resumo.length === 0 && (
              <tr><td colSpan={7} className="rel-vazio">Sem dados para este período.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Aba Por Rota
// ─────────────────────────────────────────────────────────────────────────────
function AbaRota({ operacoes }) {
  const resumo = useMemo(() => {
    const m = new Map()
    for (const op of operacoes) {
      const rota = op.rota || '(sem rota)'
      if (!m.has(rota)) m.set(rota, { rota, ops: 0, prev: 0, real: 0, lt: [], div: 0 })
      const r = m.get(rota)
      r.ops++
      r.prev  += op.entregas_previstas  ?? 0
      r.real  += op.entregas_realizadas ?? 0
      if (op.lead_time_min != null) r.lt.push(op.lead_time_min)
      if (op.divergencia)           r.div++
    }
    return Array.from(m.values())
      .map(r => ({
        ...r,
        pct: pct(r.real, r.prev),
        ltMedio: r.lt.length > 0 ? Math.round(r.lt.reduce((a, b) => a + b, 0) / r.lt.length) : null,
      }))
      .sort((a, b) => b.ops - a.ops)
  }, [operacoes])

  const COLS = [
    { chave: 'rota',    rotulo: 'Rota'         },
    { chave: 'ops',     rotulo: 'Operações'    },
    { chave: 'prev',    rotulo: 'Previstas'    },
    { chave: 'real',    rotulo: 'Realizadas'   },
    { chave: 'pct',     rotulo: '% Execução'   },
    { chave: 'ltMedio', rotulo: 'LT Médio'     },
    { chave: 'div',     rotulo: 'Divergências' },
  ]
  const linhas = resumo.map(r => ({ ...r, ltMedio: fmtMin(r.ltMedio) }))

  return (
    <div className="rel-card">
      <div className="rel-card-hdr">
        <span className="rel-card-title">Desempenho por Rota</span>
        <ExportButtons colunas={COLS} linhas={linhas} nomeArquivo="relatorio-por-rota" titulo="Relatório por Rota" />
      </div>
      <div className="rel-tbl-wrap">
        <table className="rel-tbl">
          <thead>
            <tr><th>#</th><th>Rota</th><th>Operações</th><th>Previstas</th><th>Realizadas</th><th>% Execução</th><th>LT Médio</th><th>Divergências</th></tr>
          </thead>
          <tbody>
            {resumo.map((r, i) => (
              <tr key={r.rota}>
                <td className="rel-dim" style={{ fontWeight: 700 }}>{i + 1}</td>
                <td style={{ fontWeight: 500 }}>{r.rota}</td>
                <td className="rel-num">{r.ops}</td>
                <td className="rel-num">{r.prev}</td>
                <td className="rel-num">{r.real}</td>
                <td style={{ minWidth: 110 }}><PctBar val={r.pct} /></td>
                <td className="rel-num">{fmtMin(r.ltMedio)}</td>
                <td className="rel-num" style={{ color: r.div > 0 ? 'var(--red)' : 'var(--text4)', fontWeight: r.div > 0 ? 700 : 400 }}>
                  {r.div || '—'}
                </td>
              </tr>
            ))}
            {resumo.length === 0 && (
              <tr><td colSpan={8} className="rel-vazio">Sem dados para este período.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Aba Divergências
// ─────────────────────────────────────────────────────────────────────────────
function AbaDivergencias({ operacoes }) {
  const div = useMemo(() => calcularRelatorioDivergencias(operacoes), [operacoes])

  const COLS = [
    { chave: 'data_operacao',   rotulo: 'Data'         },
    { chave: 'nome_motorista',  rotulo: 'Motorista'    },
    { chave: 'tipo_operacao',   rotulo: 'Tipo'         },
    { chave: 'rota',            rotulo: 'Rota'         },
    { chave: 'status',          rotulo: 'Status'       },
    { chave: 'divergencia',     rotulo: 'Divergência'  },
  ]
  const linhas = div.registros.map(o => ({
    ...o, data_operacao: fmtData(o.data_operacao),
  }))

  return (
    <>
      <div className="rel-kpi-row">
        <div className="rel-kpi"><div className="rel-kpi-val" style={{ color: 'var(--red)' }}>{div.quantidade}</div><div className="rel-kpi-lbl">Total divergências</div></div>
        <div className="rel-kpi"><div className="rel-kpi-val" style={{ color: 'var(--amber)' }}>{div.percentual}%</div><div className="rel-kpi-lbl">% do total de ops</div></div>
        <div className="rel-kpi"><div className="rel-kpi-val">{div.motoristasEnvolvidos.length}</div><div className="rel-kpi-lbl">Motoristas</div></div>
      </div>

      <div className="rel-grid2">
        <div className="rel-card">
          <div className="rel-card-hdr"><span className="rel-card-title">Motoristas com mais divergências</span></div>
          <div className="rel-tbl-wrap">
            <table className="rel-tbl">
              <thead><tr><th>#</th><th>Motorista</th><th>Código</th><th>Ocorrências</th></tr></thead>
              <tbody>
                {div.motoristasEnvolvidos.slice(0, 10).map((m, i) => (
                  <tr key={m.codigo}>
                    <td className="rel-dim">{i + 1}</td>
                    <td style={{ fontWeight: 500 }}>{m.nome}</td>
                    <td className="rel-mono">{m.codigo}</td>
                    <td className="rel-num" style={{ color: 'var(--red)', fontWeight: 700 }}>{m.quantidade}</td>
                  </tr>
                ))}
                {div.motoristasEnvolvidos.length === 0 && (
                  <tr><td colSpan={4} className="rel-vazio" style={{ color: 'var(--green)' }}>✓ Nenhuma divergência no período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rel-card">
          <div className="rel-card-hdr"><span className="rel-card-title">Evolução por mês</span></div>
          <div className="rel-tbl-wrap">
            <table className="rel-tbl">
              <thead><tr><th>Mês</th><th>Divergências</th></tr></thead>
              <tbody>
                {div.evolucaoPorPeriodo.map(e => (
                  <tr key={e.mes}>
                    <td>{e.mes}</td>
                    <td className="rel-num" style={{ color: 'var(--red)', fontWeight: 700 }}>{e.quantidade}</td>
                  </tr>
                ))}
                {div.evolucaoPorPeriodo.length === 0 && (
                  <tr><td colSpan={2} className="rel-vazio">—</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rel-card">
        <div className="rel-card-hdr">
          <span className="rel-card-title">Registros com divergência</span>
          <ExportButtons colunas={COLS} linhas={linhas} nomeArquivo="relatorio-divergencias" titulo="Relatório de Divergências" />
        </div>
        <div className="rel-tbl-wrap">
          <table className="rel-tbl">
            <thead><tr><th>Data</th><th>Motorista</th><th>Tipo</th><th>Rota</th><th>Status</th><th>Divergência</th></tr></thead>
            <tbody>
              {div.registros.slice(0, 200).map(o => (
                <tr key={o.id}>
                  <td className="rel-dim">{fmtData(o.data_operacao)}</td>
                  <td style={{ fontWeight: 500 }}>{o.nome_motorista}</td>
                  <td><BadgeTipo tipo={o.tipo_operacao} /></td>
                  <td>{o.rota || '—'}</td>
                  <td><BadgeStatus status={o.status} /></td>
                  <td style={{ color: 'var(--red)', fontSize: 12.5 }}>{o.divergencia}</td>
                </tr>
              ))}
              {div.registros.length === 0 && (
                <tr><td colSpan={6} className="rel-vazio" style={{ color: 'var(--green)' }}>✓ Nenhuma divergência registrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
export default function Relatorios() {
  const [abaAtiva, setAbaAtiva] = useState('diario')
  const [operacoes, setOperacoes] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  // Filtros comuns
  const [dataInicio, setDataInicio] = useState(hoje())
  const [dataFim, setDataFim]       = useState(hoje())
  const [tipoOp, setTipoOp]         = useState('')
  const [motoristaId, setMotoristaId] = useState('')
  const [motoristas, setMotoristas] = useState([])

  const refEmVoo = useRef('')

  // Carregar motoristas para o select
  useEffect(() => {
    listarMotoristas({ ativo: true, porPagina: 200 })
      .then(({ dados }) => setMotoristas(dados ?? []))
  }, [])

  // Quando troca de aba, ajusta período automaticamente
  useEffect(() => {
    if (['diario','semanal','mensal'].includes(abaAtiva)) {
      const { dataInicio: di, dataFim: df } = periodoParaAba(abaAtiva)
      setDataInicio(di)
      setDataFim(df)
    }
  }, [abaAtiva])

  const carregarDados = useCallback(async () => {
    const sig = [dataInicio, dataFim, tipoOp, motoristaId].join('|')
    refEmVoo.current = sig
    setCarregando(true)
    setErro('')
    const { dados, erro: e } = await buscarOperacoesRelatorio({
      dataInicio, dataFim, tipoOperacao: tipoOp, motoristaId,
    })
    if (refEmVoo.current !== sig) return
    if (e) setErro(e)
    else setOperacoes(dados)
    setCarregando(false)
  }, [dataInicio, dataFim, tipoOp, motoristaId])

  useEffect(() => { carregarDados() }, [carregarDados])

  const tituloAba = ABAS.find(a => a.id === abaAtiva)?.label ?? ''

  return (
    <div className="rel-page">
      <div className="rel-header">
        <div className="rel-header-left">
          <div className="rel-header-icon"><IconFileText width={20} height={20} /></div>
          <div>
            <h2>Relatórios</h2>
            <p>Análise detalhada · exportação PDF, Excel e CSV</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={carregarDados}>Atualizar</Button>
      </div>

      {/* Seletor de abas */}
      <div className="rel-abas">
        {ABAS.map(a => (
          <button
            key={a.id}
            type="button"
            className={`rel-aba${abaAtiva === a.id ? ' rel-aba-ativa' : ''}`}
            onClick={() => setAbaAtiva(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="rel-filtros">
        <div className="rel-fg">
          <label className="rel-fl">De</label>
          <input className="rel-fi" type="date" value={dataInicio}
            onChange={e => setDataInicio(e.target.value)} />
        </div>
        <div className="rel-fg">
          <label className="rel-fl">Até</label>
          <input className="rel-fi" type="date" value={dataFim}
            onChange={e => setDataFim(e.target.value)} />
        </div>
        <div className="rel-fg">
          <label className="rel-fl">Tipo</label>
          <select className="rel-fs" value={tipoOp} onChange={e => setTipoOp(e.target.value)}>
            <option value="">Todos</option>
            {TIPOS_OPERACAO.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="rel-fg">
          <label className="rel-fl">Motorista</label>
          <select className="rel-fs" value={motoristaId} onChange={e => setMotoristaId(e.target.value)}
            style={{ width: 180 }}>
            <option value="">Todos</option>
            {motoristas.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
      </div>

      {/* Erro */}
      {erro && (
        <div className="rel-erro">
          <IconAlertCircle width={15} height={15} /> {erro}
        </div>
      )}

      {/* Conteúdo */}
      {carregando ? (
        <div className="rel-carregando">Carregando relatório…</div>
      ) : (
        <>
          {(abaAtiva === 'diario' || abaAtiva === 'semanal' || abaAtiva === 'mensal') && (
            <AbaGeral operacoes={operacoes} titulo={tituloAba} />
          )}
          {abaAtiva === 'motorista' && <AbaMotorista operacoes={operacoes} />}
          {abaAtiva === 'rota'       && <AbaRota operacoes={operacoes} />}
          {abaAtiva === 'divergencia'&& <AbaDivergencias operacoes={operacoes} />}
        </>
      )}
    </div>
  )
}
