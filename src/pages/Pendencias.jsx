import { useCallback, useEffect, useRef, useState } from 'react'
import {
  detectarPendencias,
  buscarStatusPorMotorista,
  buscarHistoricoImportacoesComprovei,
  buscarUltimaImportacaoComprovei,
  LIMIAR_HORAS_SEM_ATUALIZACAO,
} from '../lib/pendenciasService'
import { processarImportacao, ORIGENS_IMPORTACAO } from '../lib/importacoesService'
import { useAutoRefresh } from '../lib/useAutoRefresh'
import Button from '../components/ui/Button'
import { IconAlert, IconAlertCircle, IconUpload } from '../components/ui/Icons'
import './Pendencias.css'

// ─────────────────────────────────────────────────────────────────────────────
const LABEL_TIPO = {
  SEM_ATUALIZACAO:        'Sem atualização',
  COMPROVEI_SEM_OPERACAO: 'COMPROVEI sem Op.',
  OPERACAO_SEM_COMPROVEI: 'Op. sem COMPROVEI',
  DIVERGENCIA_ROTA:       'Divergência de rota',
  STATUS_INCOERENTE:      'Status incoerente',
  STATUS_DESCONHECIDO:    'Status desconhecido',
}

const COR_SEV = { ALTA: 'var(--red)', MEDIA: 'var(--amber)', BAIXA: 'var(--text3)' }
const BG_SEV  = { ALTA: 'var(--red-bg)', MEDIA: 'var(--amber-bg)', BAIXA: 'var(--bg3)' }
const BORDA_SEV = { ALTA: '#fca5a5', MEDIA: '#fde68a', BAIXA: 'var(--border)' }

function BadgeSev({ sev }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      background: BG_SEV[sev], color: COR_SEV[sev],
      border: `1px solid ${BORDA_SEV[sev]}`,
    }}>
      {sev}
    </span>
  )
}

function fmtTs(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function horasDesde(iso) {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

function corHoras(h) {
  if (h == null) return 'var(--text4)'
  if (h > 8)  return 'var(--red)'
  if (h > LIMIAR_HORAS_SEM_ATUALIZACAO) return 'var(--amber)'
  return 'var(--green)'
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB: Card KPI
// ─────────────────────────────────────────────────────────────────────────────
function Kpi({ label, valor, cor, hl }) {
  return (
    <div className="pend-kpi" style={hl ? { borderColor: cor, borderWidth: 2 } : {}}>
      <div className="pend-kpi-val" style={{ color: cor }}>{valor ?? '—'}</div>
      <div className="pend-kpi-lbl">{label}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB: Upload inline de arquivo COMPROVEI
// ─────────────────────────────────────────────────────────────────────────────
function UploadComprovei({ onImportado }) {
  const [arquivo, setArquivo]     = useState(null)
  const [enviando, setEnviando]   = useState(false)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro]           = useState('')
  const inputRef = useRef(null)

  async function handleUpload() {
    if (!arquivo) return
    setEnviando(true)
    setErro('')
    setResultado(null)

    const res = await processarImportacao(arquivo, ORIGENS_IMPORTACAO.COMPROVEI, false)
    setEnviando(false)

    if (res.duplicata) {
      setErro(`Arquivo já importado em ${fmtTs(res.duplicata.created_at)} (${res.duplicata.nome_arquivo}).`)
      return
    }
    if (!res.sucesso) {
      setErro(res.erro || 'Erro ao processar arquivo.')
      return
    }

    const f = res.funil
    setResultado({
      arquivo:   arquivo.name,
      pedidos:   f?.inseridos ?? 0,
      ignorados: f?.ignorados ?? 0,
      ts:        new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    })
    setArquivo(null)
    if (inputRef.current) inputRef.current.value = ''
    onImportado?.()
  }

  return (
    <div className="pend-upload-card">
      <div className="pend-upload-titulo">
        <IconUpload width={16} height={16} />
        Importar Atualização COMPROVEI
      </div>
      <div className="pend-upload-desc">
        Faça upload do arquivo CSV baixado do COMPROVEI a qualquer momento do dia.
        O sistema atualiza o status de cada motorista e recalcula as pendências automaticamente.
      </div>

      <div className="pend-upload-zona"
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          const f = e.dataTransfer.files[0]
          if (f) setArquivo(f)
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => setArquivo(e.target.files[0] || null)}
        />
        {arquivo ? (
          <div className="pend-upload-arquivo">
            <span style={{ fontSize: 20 }}>📄</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{arquivo.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>
                {(arquivo.size / 1024).toFixed(1)} KB
              </div>
            </div>
            <button
              type="button"
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16 }}
              onClick={e => { e.stopPropagation(); setArquivo(null); if (inputRef.current) inputRef.current.value = '' }}
            >✕</button>
          </div>
        ) : (
          <div className="pend-upload-vazio">
            <span style={{ fontSize: 28 }}>☁️</span>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Arraste o arquivo ou clique aqui</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>CSV ou XLSX do COMPROVEI</div>
          </div>
        )}
      </div>

      {erro && (
        <div className="pend-erro" style={{ marginTop: 10 }}>
          <IconAlertCircle width={14} height={14} /> {erro}
        </div>
      )}

      {resultado && (
        <div className="pend-sucesso">
          ✓ Importado às {resultado.ts} — {resultado.pedidos} pedido(s) · {resultado.ignorados} ignorado(s)
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <Button variant="primary" size="sm" onClick={handleUpload}
          carregando={enviando} disabled={!arquivo || enviando}>
          {enviando ? 'Processando…' : 'Processar arquivo'}
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB: Tabela de status por motorista
// ─────────────────────────────────────────────────────────────────────────────
function TabelaStatusMotoristas({ motoristas, carregando }) {
  if (carregando) return <div className="pend-carregando">Carregando status…</div>
  if (motoristas.length === 0) {
    return (
      <div className="pend-vazio">
        <div style={{ fontSize: 32 }}>📭</div>
        <div style={{ fontWeight: 600 }}>Nenhum dado disponível.</div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>Importe um arquivo COMPROVEI para ver o status dos motoristas.</div>
      </div>
    )
  }

  return (
    <div className="pend-tbl-wrap">
      <table className="pend-tbl">
        <thead>
          <tr>
            <th>Motorista</th>
            <th>Placa</th>
            <th>Rota atual</th>
            <th>Status</th>
            <th className="pend-th-num">Hoje</th>
            <th className="pend-th-num">Em rota</th>
            <th className="pend-th-num">Entregues</th>
            <th>Última atualização</th>
            <th>Importado em</th>
          </tr>
        </thead>
        <tbody>
          {motoristas.map(m => {
            const horas = horasDesde(m.ultima_atualizacao || m.importado_em)
            return (
              <tr key={m.cpf_motorista}>
                <td style={{ fontWeight: 500 }}>{m.nome_motorista}</td>
                <td className="pend-mono">{m.placa || '—'}</td>
                <td>{m.rota_atual || '—'}</td>
                <td>
                  {m.status_entrega
                    ? <span style={{ fontSize: 12 }}>{m.status_entrega}</span>
                    : <span className="pend-dim">—</span>}
                </td>
                <td className="pend-th-num">{m.qtd_pedidos_hoje ?? 0}</td>
                <td className="pend-th-num" style={{ color: (m.qtd_em_rota ?? 0) > 0 ? 'var(--amber)' : 'var(--text3)', fontWeight: 600 }}>
                  {m.qtd_em_rota ?? 0}
                </td>
                <td className="pend-th-num" style={{ color: (m.qtd_entregues ?? 0) > 0 ? 'var(--green)' : 'var(--text3)', fontWeight: 600 }}>
                  {m.qtd_entregues ?? 0}
                </td>
                <td style={{ fontSize: 12, color: corHoras(horas) }}>
                  {horas != null ? (
                    `${fmtTs(m.ultima_atualizacao || m.importado_em)} (${Math.floor(horas)}h atrás)`
                  ) : '—'}
                </td>
                <td className="pend-dim" style={{ fontSize: 12 }}>
                  {fmtTs(m.importado_em)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
const ABAS = [
  { id: 'pendencias', label: 'Pendências' },
  { id: 'motoristas', label: 'Status por Motorista' },
  { id: 'historico',  label: 'Histórico de Importações' },
]

export default function Pendencias() {
  const [aba, setAba]                 = useState('pendencias')
  const [data, setData]               = useState(new Date().toISOString().slice(0, 10))
  const [filtroTipo, setFiltroTipo]   = useState('')
  const [filtroSev,  setFiltroSev]    = useState('')
  const [expandido,  setExpandido]    = useState(null)

  // Pendências
  const [dadosPend, setDadosPend]     = useState(null)
  const [carregPend, setCarregPend]   = useState(true)
  const [erroPend, setErroPend]       = useState('')

  // Status motoristas
  const [motoristas, setMotoristas]   = useState([])
  const [carregMot, setCarregMot]     = useState(false)

  // Histórico
  const [historico, setHistorico]     = useState([])
  const [ultimaImp, setUltimaImp]     = useState(null)

  // Refs race condition
  const refPend = useRef('')
  const refMot  = useRef('')

  // ── Carregar pendências ───────────────────────────────────────────────────
  const carregarPendencias = useCallback(async () => {
    const sig = data
    refPend.current = sig
    setCarregPend(true); setErroPend('')
    const { dados, erro } = await detectarPendencias(data)
    if (refPend.current !== sig) return
    if (erro) setErroPend(erro)
    else setDadosPend(dados)
    setCarregPend(false)
  }, [data])

  // ── Carregar status motoristas ────────────────────────────────────────────
  const carregarMotoristas = useCallback(async () => {
    const sig = 'mot'
    refMot.current = sig
    setCarregMot(true)
    const { dados } = await buscarStatusPorMotorista()
    if (refMot.current !== sig) return
    setMotoristas(dados)
    setCarregMot(false)
  }, [])

  // ── Carregar histórico e última importação ─────────────────────────────────
  const carregarHistorico = useCallback(async () => {
    const [resHist, resUlt] = await Promise.all([
      buscarHistoricoImportacoesComprovei(),
      buscarUltimaImportacaoComprovei(),
    ])
    setHistorico(resHist.dados)
    setUltimaImp(resUlt.dados)
  }, [])

  // ── Carregar tudo ao montar ────────────────────────────────────────────────
  useEffect(() => {
    carregarPendencias()
    carregarMotoristas()
    carregarHistorico()
  }, [carregarPendencias, carregarMotoristas, carregarHistorico])

  useAutoRefresh(carregarPendencias, 120_000) // pendências a cada 2min

  // Ao trocar aba, carregar dados se necessário
  useEffect(() => {
    if (aba === 'motoristas') carregarMotoristas()
    if (aba === 'historico')  carregarHistorico()
  }, [aba, carregarMotoristas, carregarHistorico])

  function aposImportacao() {
    // Recalcular tudo após nova importação
    carregarPendencias()
    carregarMotoristas()
    carregarHistorico()
  }

  const pendencias = dadosPend?.pendencias ?? []
  const filtradas  = pendencias.filter(p =>
    (!filtroTipo || p.tipo === filtroTipo) &&
    (!filtroSev  || p.severidade === filtroSev)
  )

  return (
    <div className="pend-page">

      {/* Header */}
      <div className="pend-header">
        <div className="pend-header-left">
          <div className="pend-header-icon"><IconAlert width={20} height={20} /></div>
          <div>
            <h2>Pendências Operacionais</h2>
            <p>
              Monitoramento COMPROVEI ↔ Operação do Dia
              {ultimaImp && (
                <span style={{ marginLeft: 10, color: 'var(--text4)', fontSize: 11 }}>
                  · última importação: {fmtTs(ultimaImp.importado_em)}
                </span>
              )}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date" value={data}
            onChange={e => setData(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius2)', fontSize: 13, fontFamily: 'inherit' }}
          />
          <Button variant="secondary" size="sm" onClick={() => { carregarPendencias(); carregarMotoristas(); carregarHistorico() }}>
            Atualizar
          </Button>
        </div>
      </div>

      {/* Importação inline */}
      <UploadComprovei onImportado={aposImportacao} />

      {/* KPIs */}
      {dadosPend && (
        <div className="pend-kpi-row">
          <Kpi label="Total pendências"    valor={dadosPend.kpis.total}            cor="var(--orange)" hl={dadosPend.kpis.total > 0} />
          <Kpi label="Alta severidade"     valor={dadosPend.kpis.criticas}         cor="var(--red)"    hl={dadosPend.kpis.criticas > 0} />
          <Kpi label="Sem atualização"     valor={dadosPend.kpis.semAtualizacao}   cor="var(--amber)"  />
          <Kpi label="Op. sem COMPROVEI"   valor={dadosPend.kpis.opSemComprovei}   cor="var(--red)"    />
          <Kpi label="COMPROVEI sem Op."   valor={dadosPend.kpis.comproveiSemOp}   cor="var(--amber)"  />
          <Kpi label="Div. de rota"        valor={dadosPend.kpis.divRota}          cor="var(--purple)" />
          <Kpi label="Motoristas COMPROVEI"valor={dadosPend.totalMotoristasComp}   cor="var(--text2)"  />
          <Kpi label="Ops. hoje"           valor={dadosPend.totalOpsHoje}          cor="var(--text2)"  />
        </div>
      )}

      {/* Abas */}
      <div className="pend-abas">
        {ABAS.map(a => (
          <button
            key={a.id}
            type="button"
            className={`pend-aba${aba === a.id ? ' pend-aba-ativa' : ''}`}
            onClick={() => setAba(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* ── Aba Pendências ── */}
      {aba === 'pendencias' && (
        <>
          {erroPend && <div className="pend-erro"><IconAlertCircle width={14} height={14} />{erroPend}</div>}

          <div className="pend-filtros">
            <div className="pend-fg">
              <label className="pend-fl">Tipo</label>
              <select className="pend-fs" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(LABEL_TIPO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="pend-fg">
              <label className="pend-fl">Severidade</label>
              <select className="pend-fs" value={filtroSev} onChange={e => setFiltroSev(e.target.value)}>
                <option value="">Todas</option>
                <option value="ALTA">Alta</option>
                <option value="MEDIA">Média</option>
                <option value="BAIXA">Baixa</option>
              </select>
            </div>
            <div style={{ alignSelf: 'flex-end', fontSize: 12, color: 'var(--text3)' }}>
              {filtradas.length} pendência(s)
            </div>
          </div>

          {carregPend ? (
            <div className="pend-carregando">Analisando dados…</div>
          ) : filtradas.length === 0 ? (
            <div className="pend-vazio">
              <div style={{ fontSize: 36 }}>✅</div>
              <div style={{ fontWeight: 700 }}>
                {pendencias.length === 0
                  ? 'Nenhuma pendência detectada. Importe um arquivo COMPROVEI para iniciar o monitoramento.'
                  : 'Nenhuma pendência neste filtro.'}
              </div>
            </div>
          ) : (
            <div className="pend-lista">
              {filtradas.map((p, i) => (
                <div key={i} className="pend-item" style={{ borderLeftColor: COR_SEV[p.severidade] }}>
                  <div className="pend-item-hdr" onClick={() => setExpandido(expandido === i ? null : i)}>
                    <BadgeSev sev={p.severidade} />
                    <span className="pend-item-tipo">{LABEL_TIPO[p.tipo] ?? p.tipo}</span>
                    {p.motorista && <span className="pend-item-motorista">👤 {p.motorista}</span>}
                    {p.rota      && <span className="pend-item-rota">📍 {p.rota}</span>}
                    <span className="pend-item-desc">{p.descricao}</span>
                    <span className="pend-item-toggle">{expandido === i ? '▲' : '▼'}</span>
                  </div>
                  {expandido === i && p.detalhe && (
                    <div className="pend-item-detalhe">
                      <pre style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                        {JSON.stringify(p.detalhe, null, 2).slice(0, 400)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Aba Status por Motorista ── */}
      {aba === 'motoristas' && (
        <div className="pend-card">
          <div className="pend-card-hdr">
            <span className="pend-card-title">Último Status Conhecido — por Motorista</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{motoristas.length} motoristas</span>
          </div>
          <TabelaStatusMotoristas motoristas={motoristas} carregando={carregMot} />
          {motoristas.length > 0 && (
            <div className="pend-nota">
              Verde = atualizado há menos de {LIMIAR_HORAS_SEM_ATUALIZACAO}h ·
              Amarelo = há mais de {LIMIAR_HORAS_SEM_ATUALIZACAO}h · Vermelho = há mais de 8h
            </div>
          )}
        </div>
      )}

      {/* ── Aba Histórico ── */}
      {aba === 'historico' && (
        <div className="pend-card">
          <div className="pend-card-hdr"><span className="pend-card-title">Histórico de Importações COMPROVEI</span></div>
          <div className="pend-tbl-wrap">
            <table className="pend-tbl">
              <thead>
                <tr><th>Data / Hora</th><th>Arquivo</th><th>Pedidos</th><th>Válidos</th><th>Status</th></tr>
              </thead>
              <tbody>
                {historico.map(h => (
                  <tr key={h.id}>
                    <td className="pend-dim" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtTs(h.created_at)}</td>
                    <td style={{ fontSize: 12 }}>{h.nome_arquivo}</td>
                    <td className="pend-th-num">{h.total_registros ?? '—'}</td>
                    <td className="pend-th-num" style={{ color: 'var(--green)' }}>{h.registros_validos ?? '—'}</td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                        background: h.status === 'concluido' ? 'var(--green-bg)' : 'var(--amber-bg)',
                        color: h.status === 'concluido' ? 'var(--green)' : 'var(--amber)',
                      }}>
                        {h.status === 'concluido' ? 'Concluído' : h.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {historico.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text3)' }}>
                    Nenhuma importação registrada. Faça o primeiro upload acima.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
