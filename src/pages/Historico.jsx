import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listarHistorico,
  buscarTodoHistoricoFiltrado,
  calcularIndicadoresHistorico,
} from '../lib/historicoService'
import { listarMotoristasComOperacao, TIPOS_OPERACAO, STATUS_OPERACAO } from '../lib/operacoesService'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { formatarDataBR, formatarAtualizadoEm, formatarLeadTime } from '../lib/dataHoraUtils'
import { calcularIntervaloPeriodo } from '../lib/leadTimeService'

import Button from '../components/ui/Button'
import Pagination from '../components/ui/Pagination'
import OperacaoStatusBadge from '../components/ui/OperacaoStatusBadge'
import {
  IconSearch,
  IconArrowUpDown,
  IconArchive,
  IconAlertCircle,
} from '../components/ui/Icons'

import HistoricoDetalheModal from './HistoricoDetalheModal'
import './Historico.css'

const POR_PAGINA = 10

const COLUNAS_TABELA = [
  { coluna: 'data_operacao', label: 'Data', ordenavel: true },
  { coluna: 'nome_motorista', label: 'Motorista', ordenavel: true },
  { coluna: null, label: 'Tipo', ordenavel: false },
  { coluna: null, label: 'Rota', ordenavel: false },
  { coluna: null, label: 'Placa', ordenavel: false },
  { coluna: null, label: 'Previstas', ordenavel: false },
  { coluna: null, label: 'Realizadas', ordenavel: false },
  { coluna: 'percentual_conclusao', label: '%', ordenavel: true },
  { coluna: 'lead_time_min', label: 'Lead Time', ordenavel: true },
  { coluna: null, label: 'Status', ordenavel: false },
  { coluna: null, label: 'Divergência', ordenavel: false },
  { coluna: null, label: 'Atualizado', ordenavel: false },
]

function corPercentual(p) {
  if (p >= 90) return 'hist-percentual-alto'
  if (p >= 70) return 'hist-percentual-medio'
  return 'hist-percentual-baixo'
}

export default function Historico() {
  // ---- filtros ----
  const [busca, setBusca] = useState('')
  const buscaDebounced = useDebouncedValue(busca, 350)
  const [periodo, setPeriodo] = useState('')
  const [dataInicioCustom, setDataInicioCustom] = useState('')
  const [dataFimCustom, setDataFimCustom] = useState('')
  const [motoristaId, setMotoristaId] = useState('')
  const [tipoOperacao, setTipoOperacao] = useState('')
  const [status, setStatus] = useState('')
  const [rota, setRota] = useState('')
  const rotaDebounced = useDebouncedValue(rota, 350)
  const [placa, setPlaca] = useState('')
  const placaDebounced = useDebouncedValue(placa, 350)
  const [ordenacao, setOrdenacao] = useState({ coluna: 'data_operacao', direcao: 'desc' })
  const [pagina, setPagina] = useState(1)

  // ---- dados ----
  const [operacoes, setOperacoes] = useState([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [motoristasDisponiveis, setMotoristasDisponiveis] = useState([])
  const [indicadores, setIndicadores] = useState(null)

  // ---- modal de detalhe ----
  const [operacaoSelecionada, setOperacaoSelecionada] = useState(null)

  const intervalo = useMemo(() => {
    if (periodo === 'personalizado') {
      return { dataInicio: dataInicioCustom, dataFim: dataFimCustom }
    }
    if (!periodo) return { dataInicio: '', dataFim: '' }
    return calcularIntervaloPeriodo(periodo)
  }, [periodo, dataInicioCustom, dataFimCustom])

  // assinatura do filtro atual — mesmo padrão validado nos módulos
  // anteriores (Motoristas, Auditoria, Operação do Dia, Lead Time)
  const assinaturaFiltro = `${buscaDebounced}::${intervalo.dataInicio}::${intervalo.dataFim}::${motoristaId}::${tipoOperacao}::${status}::${rotaDebounced}::${placaDebounced}`
  const filtroAnteriorRef = useRef(assinaturaFiltro)
  const ultimaBuscaAutomaticaRef = useRef('')

  const filtrosAtuais = {
    busca: buscaDebounced,
    dataInicio: intervalo.dataInicio,
    dataFim: intervalo.dataFim,
    motoristaId,
    tipoOperacao,
    status,
    rota: rotaDebounced,
    placa: placaDebounced,
  }

  const carregarHistorico = useCallback(
    async ({ forcar = false } = {}) => {
      const mudouFiltro = assinaturaFiltro !== filtroAnteriorRef.current
      const paginaEfetiva = mudouFiltro ? 1 : pagina
      const chaveCompleta = `${assinaturaFiltro}::${ordenacao.coluna}:${ordenacao.direcao}::${paginaEfetiva}`

      if (!forcar && chaveCompleta === ultimaBuscaAutomaticaRef.current) {
        return
      }

      setCarregando(true)
      setErro('')

      if (mudouFiltro) {
        filtroAnteriorRef.current = assinaturaFiltro
        if (pagina !== 1) setPagina(1)
      }

      const [resultadoLista, resultadoCompleto] = await Promise.all([
        listarHistorico({ ...filtrosAtuais, ordenacao, pagina: paginaEfetiva, porPagina: POR_PAGINA }),
        buscarTodoHistoricoFiltrado(filtrosAtuais),
      ])

      setCarregando(false)
      ultimaBuscaAutomaticaRef.current = chaveCompleta

      if (resultadoLista.erro) {
        setErro(resultadoLista.erro)
        setOperacoes([])
        setTotal(0)
        setIndicadores(null)
        return
      }
      setOperacoes(resultadoLista.dados)
      setTotal(resultadoLista.total)

      if (!resultadoCompleto.erro) {
        setIndicadores(calcularIndicadoresHistorico(resultadoCompleto.dados))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assinaturaFiltro, pagina, ordenacao]
  )

  useEffect(() => {
    carregarHistorico()
  }, [carregarHistorico])

  useEffect(() => {
    listarMotoristasComOperacao().then((resultado) => {
      if (!resultado.erro) setMotoristasDisponiveis(resultado.dados)
    })
  }, [])

  function alternarOrdenacao(coluna) {
    setOrdenacao((atual) =>
      atual.coluna === coluna
        ? { coluna, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' }
        : { coluna, direcao: coluna === 'data_operacao' ? 'desc' : 'asc' }
    )
  }

  function limparFiltros() {
    setBusca('')
    setPeriodo('')
    setDataInicioCustom('')
    setDataFimCustom('')
    setMotoristaId('')
    setTipoOperacao('')
    setStatus('')
    setRota('')
    setPlaca('')
  }

  const temFiltroAtivo = !!(
    busca ||
    periodo ||
    motoristaId ||
    tipoOperacao ||
    status ||
    rota ||
    placa
  )

  return (
    <div>
      <div className="hist-header">
        <div>
          <h2>Histórico Operacional</h2>
          <p>Operações finalizadas (Entrega finalizada ou Concluído), armazenadas permanentemente.</p>
        </div>
      </div>

      {indicadores && (
        <div className="hist-indicadores-grid">
          <div className="hist-indicador-card total">
            <div className="hist-indicador-label">Total finalizadas</div>
            <div className="hist-indicador-valor">{indicadores.total}</div>
          </div>
          <div className="hist-indicador-card df">
            <div className="hist-indicador-label">Total DF</div>
            <div className="hist-indicador-valor">{indicadores.totalDF}</div>
          </div>
          <div className="hist-indicador-card adega">
            <div className="hist-indicador-label">Total Adega</div>
            <div className="hist-indicador-valor">{indicadores.totalAdega}</div>
          </div>
          <div className="hist-indicador-card filial">
            <div className="hist-indicador-label">Total Filial</div>
            <div className="hist-indicador-valor">{indicadores.totalFilial}</div>
          </div>
          <div className="hist-indicador-card leadtime">
            <div className="hist-indicador-label">Lead Time médio</div>
            <div className="hist-indicador-valor" style={{ fontSize: 16 }}>
              {formatarLeadTime(indicadores.leadTimeMedio)}
            </div>
          </div>
          <div className="hist-indicador-card divergencia">
            <div className="hist-indicador-label">Com divergência</div>
            <div className="hist-indicador-valor">{indicadores.comDivergencia}</div>
          </div>
        </div>
      )}

      <div className="hist-filters-card">
        <div className="hist-filters-grid">
          <div className="hist-field" style={{ gridColumn: 'span 2' }}>
            <label>Pesquisar</label>
            <div className="hist-search-wrap">
              <IconSearch />
              <input
                type="text"
                placeholder="Código, motorista, rota, placa..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                aria-label="Pesquisar no histórico"
              />
            </div>
          </div>

          <div className="hist-field">
            <label>Período</label>
            <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
              <option value="">Todo o período</option>
              <option value="dia">Hoje</option>
              <option value="semana">Última semana</option>
              <option value="mes">Este mês</option>
              <option value="ano">Este ano</option>
              <option value="personalizado">Personalizado</option>
            </select>
          </div>

          {periodo === 'personalizado' && (
            <>
              <div className="hist-field">
                <label>De</label>
                <input type="date" value={dataInicioCustom} onChange={(e) => setDataInicioCustom(e.target.value)} />
              </div>
              <div className="hist-field">
                <label>Até</label>
                <input type="date" value={dataFimCustom} onChange={(e) => setDataFimCustom(e.target.value)} />
              </div>
            </>
          )}

          <div className="hist-field">
            <label>Motorista</label>
            <select value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)}>
              <option value="">Todos</option>
              {motoristasDisponiveis.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="hist-field">
            <label>Tipo</label>
            <select value={tipoOperacao} onChange={(e) => setTipoOperacao(e.target.value)}>
              <option value="">Todos</option>
              {TIPOS_OPERACAO.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="hist-field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos</option>
              {STATUS_OPERACAO.filter((s) => s === 'Entrega finalizada' || s === 'Concluído').map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="hist-field">
            <label>Rota</label>
            <input type="text" placeholder="Ex: DF-01" value={rota} onChange={(e) => setRota(e.target.value)} />
          </div>

          <div className="hist-field">
            <label>Placa</label>
            <input type="text" placeholder="ABC1D23" value={placa} onChange={(e) => setPlaca(e.target.value)} />
          </div>

          {temFiltroAtivo && (
            <div className="hist-filters-actions">
              <Button variant="ghost" size="sm" onClick={limparFiltros} style={{ width: '100%' }}>
                Limpar filtros
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="hist-table-card">
        {/* ---------- Tabela (desktop/tablet) ---------- */}
        <div className="hist-table-wrap">
          <table className="hist-table">
            <thead>
              <tr>
                {COLUNAS_TABELA.map(({ coluna, label, ordenavel }) =>
                  ordenavel ? (
                    <th
                      key={label}
                      className="sortable"
                      onClick={() => alternarOrdenacao(coluna)}
                      style={label === '%' ? { textAlign: 'center', cursor: 'pointer' } : { cursor: 'pointer' }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {label}
                        <IconArrowUpDown width={11} height={11} style={{ opacity: ordenacao.coluna === coluna ? 1 : 0.5 }} />
                      </span>
                    </th>
                  ) : (
                    <th key={label} style={label === 'Previstas' || label === 'Realizadas' ? { textAlign: 'center' } : undefined}>
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {!carregando && !erro && operacoes.length === 0 && (
                <tr>
                  <td colSpan={COLUNAS_TABELA.length}>
                    <EstadoVazio temFiltroAtivo={temFiltroAtivo} />
                  </td>
                </tr>
              )}

              {!carregando &&
                !erro &&
                operacoes.map((op) => (
                  <tr key={op.id} onClick={() => setOperacaoSelecionada(op)}>
                    <td>{formatarDataBR(op.data_operacao)}</td>
                    <td className="hist-motorista-cell">
                      {op.nome_motorista}
                      <div className="hist-codigo-cell">{op.codigo_motorista}</div>
                    </td>
                    <td>{op.tipo_operacao}</td>
                    <td>{op.rota}</td>
                    <td>{op.placa || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{op.entregas_previstas}</td>
                    <td style={{ textAlign: 'center' }}>{op.entregas_realizadas}</td>
                    <td className={`hist-percentual-cell ${corPercentual(op.percentual_conclusao)}`} style={{ textAlign: 'center' }}>
                      {op.percentual_conclusao}%
                    </td>
                    <td>{formatarLeadTime(op.lead_time_min)}</td>
                    <td>
                      <OperacaoStatusBadge status={op.status} />
                    </td>
                    <td>
                      {op.divergencia ? (
                        <span className="hist-divergencia-cell" title={op.divergencia}>
                          {op.divergencia}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="hist-atualizado-cell">{formatarAtualizadoEm(op.updated_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          {carregando && <CarregandoLista />}
          {erro && <ErroLista mensagem={erro} onTentarNovamente={() => carregarHistorico({ forcar: true })} />}
        </div>

        {/* ---------- Cards (mobile) ---------- */}
        <div className="hist-cards">
          {carregando && <CarregandoLista />}
          {erro && <ErroLista mensagem={erro} onTentarNovamente={() => carregarHistorico({ forcar: true })} />}
          {!carregando && !erro && operacoes.length === 0 && <EstadoVazio temFiltroAtivo={temFiltroAtivo} />}
          {!carregando &&
            !erro &&
            operacoes.map((op) => (
              <div key={op.id} className="hist-card" onClick={() => setOperacaoSelecionada(op)}>
                <div className="hist-card-top">
                  <div>
                    <div className="hist-card-motorista">{op.nome_motorista}</div>
                    <div className="hist-card-codigo">
                      {op.codigo_motorista} · {formatarDataBR(op.data_operacao)}
                    </div>
                  </div>
                  <OperacaoStatusBadge status={op.status} />
                </div>
                <div className="hist-card-meta">
                  <span>{op.tipo_operacao}</span>
                  <span>·</span>
                  <span>{op.rota}</span>
                  {op.placa && (
                    <>
                      <span>·</span>
                      <span>{op.placa}</span>
                    </>
                  )}
                </div>
                <div className="hist-card-row">
                  <span>
                    {op.entregas_realizadas}/{op.entregas_previstas} entregas
                  </span>
                  <span className={`hist-percentual-cell ${corPercentual(op.percentual_conclusao)}`}>
                    {op.percentual_conclusao}%
                  </span>
                </div>
                <div className="hist-card-row">
                  <span style={{ color: 'var(--text3)' }}>Lead Time</span>
                  <strong>{formatarLeadTime(op.lead_time_min)}</strong>
                </div>
                {op.divergencia && <div className="hist-card-divergencia">{op.divergencia}</div>}
              </div>
            ))}
        </div>

        {!erro && <Pagination pagina={pagina} porPagina={POR_PAGINA} total={total} onMudarPagina={setPagina} />}
      </div>

      <HistoricoDetalheModal operacao={operacaoSelecionada} onFechar={() => setOperacaoSelecionada(null)} />
    </div>
  )
}

function EstadoVazio({ temFiltroAtivo }) {
  return (
    <div className="hist-empty">
      <IconArchive />
      <p>
        {temFiltroAtivo
          ? 'Nenhuma operação finalizada encontrada para os filtros selecionados.'
          : 'Nenhuma operação finalizada ainda. As operações concluídas em "Operação do Dia" aparecerão aqui automaticamente.'}
      </p>
    </div>
  )
}

function CarregandoLista() {
  return (
    <div className="hist-empty">
      <p style={{ color: 'var(--text3)' }}>Carregando histórico...</p>
    </div>
  )
}

function ErroLista({ mensagem, onTentarNovamente }) {
  return (
    <div className="hist-empty">
      <IconAlertCircle style={{ color: 'var(--red)' }} />
      <p style={{ color: 'var(--red)', marginBottom: 12 }}>{mensagem}</p>
      <Button variant="secondary" size="sm" onClick={onTentarNovamente}>
        Tentar novamente
      </Button>
    </div>
  )
}
