import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  listarOperacoes,
  listarMotoristasComOperacao,
  excluirOperacao,
  STATUS_OPERACAO,
  TIPOS_OPERACAO,
} from '../lib/operacoesService'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { formatarDataBR, formatarAtualizadoEm } from '../lib/dataHoraUtils'

import Button from '../components/ui/Button'
import Pagination from '../components/ui/Pagination'
import Modal from '../components/ui/Modal'
import OperacaoStatusBadge from '../components/ui/OperacaoStatusBadge'
import {
  IconSearch,
  IconPlus,
  IconEdit,
  IconTrash,
  IconArrowUpDown,
  IconClipboard,
  IconAlertCircle,
  IconFileText,
  IconAlert,
} from '../components/ui/Icons'

import ConfirmDialog from '../components/ui/ConfirmDialog'
import MarcarPendenteModal from './MarcarPendenteModal'
import OperacaoForm from './OperacaoForm'
import ImportarPorFoto from './ImportarPorFoto'
import { podeFazer } from '../lib/permissions'
import './OperacaoDoDia.css'

const POR_PAGINA = 10

// Colunas fixas da tabela, na ordem exata exibida (algumas são ordenáveis)
const COLUNAS_TABELA = [
  { coluna: 'data_operacao', label: 'Data', ordenavel: true },
  { coluna: 'nome_motorista', label: 'Motorista', ordenavel: true },
  { coluna: null, label: 'Tipo', ordenavel: false },
  { coluna: null, label: 'Rota', ordenavel: false },
  { coluna: null, label: 'Placa', ordenavel: false },
  { coluna: null, label: 'Previstas', ordenavel: false },
  { coluna: null, label: 'Realizadas', ordenavel: false },
  { coluna: 'percentual_conclusao', label: '%', ordenavel: true },
  { coluna: null, label: 'Status', ordenavel: false },
  { coluna: null, label: 'Última atualização', ordenavel: false },
  { coluna: null, label: 'Ações', ordenavel: false },
]

function corPercentual(p) {
  if (p >= 90) return 'op-percentual-alto'
  if (p >= 70) return 'op-percentual-medio'
  return 'op-percentual-baixo'
}

function corBarraPercentual(p) {
  if (p >= 90) return 'var(--green)'
  if (p >= 70) return 'var(--amber)'
  return 'var(--red)'
}

export default function OperacaoDoDia() {
  // ---- filtros ----
  const [busca, setBusca] = useState('')
  const buscaDebounced = useDebouncedValue(busca, 350)
  const [dataOperacao, setDataOperacao] = useState('')
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
  const [erroLista, setErroLista] = useState('')
  const [motoristasDisponiveis, setMotoristasDisponiveis] = useState([])

  const { usuario, perfil } = useAuth()
  const nomeUsuario = usuario?.nome || usuario?.email || 'Sistema'
  const podeMarcarPendente = podeFazer('marcarPendente', perfil)
  const podeExcluir        = podeFazer('excluir', perfil)
  const podeCriar          = podeFazer('criar', perfil)

  // ---- modal de formulário ----
  const [formAberto, setFormAberto] = useState(false)
  const [operacaoEditando, setOperacaoEditando] = useState(null)
  const [feedback, setFeedback] = useState(null)

  // ---- exclusão via lixeira ----
  const [confirmExclusao, setConfirmExclusao] = useState(null) // operação alvo
  const [excluindo, setExcluindo] = useState(false)

  // ---- marcar como pendente ----
  const [operacaoParaPendente, setOperacaoParaPendente] = useState(null)

  // ---- modal de importação por foto ----
  const [fotoAberto, setFotoAberto] = useState(false)

  // assinatura do filtro atual — mesmo padrão validado nas etapas
  // anteriores (Motoristas, Auditoria): reseta a página com segurança
  // quando qualquer filtro muda, e evita requisições duplicadas.
  const assinaturaFiltro = `${buscaDebounced}::${dataOperacao}::${motoristaId}::${tipoOperacao}::${status}::${rotaDebounced}::${placaDebounced}`
  const filtroAnteriorRef = useRef(assinaturaFiltro)
  const ultimaBuscaAutomaticaRef = useRef('')

  const carregarOperacoes = useCallback(
    async ({ forcar = false } = {}) => {
      const mudouFiltro = assinaturaFiltro !== filtroAnteriorRef.current
      const paginaEfetiva = mudouFiltro ? 1 : pagina
      const chaveCompleta = `${assinaturaFiltro}::${ordenacao.coluna}:${ordenacao.direcao}::${paginaEfetiva}`

      if (!forcar && chaveCompleta === ultimaBuscaAutomaticaRef.current) {
        return
      }

      setCarregando(true)
      setErroLista('')

      if (mudouFiltro) {
        filtroAnteriorRef.current = assinaturaFiltro
        if (pagina !== 1) setPagina(1)
      }

      const resultado = await listarOperacoes({
        busca: buscaDebounced,
        dataOperacao,
        motoristaId,
        tipoOperacao,
        status,
        rota: rotaDebounced,
        placa: placaDebounced,
        ordenacao,
        pagina: paginaEfetiva,
        porPagina: POR_PAGINA,
      })
      setCarregando(false)
      ultimaBuscaAutomaticaRef.current = chaveCompleta

      if (resultado.erro) {
        setErroLista(resultado.erro)
        setOperacoes([])
        setTotal(0)
        return
      }
      setOperacoes(resultado.dados)
      setTotal(resultado.total)
    },
    [
      assinaturaFiltro,
      pagina,
      ordenacao,
      buscaDebounced,
      dataOperacao,
      motoristaId,
      tipoOperacao,
      status,
      rotaDebounced,
      placaDebounced,
    ]
  )

  useEffect(() => {
    carregarOperacoes()
  }, [carregarOperacoes])

  useEffect(() => {
    listarMotoristasComOperacao().then((resultado) => {
      if (!resultado.erro) setMotoristasDisponiveis(resultado.dados)
    })
  }, [])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = setTimeout(() => setFeedback(null), 4500)
    return () => clearTimeout(timer)
  }, [feedback])

  function alternarOrdenacao(coluna) {
    setOrdenacao((atual) =>
      atual.coluna === coluna
        ? { coluna, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' }
        : { coluna, direcao: coluna === 'data_operacao' ? 'desc' : 'asc' }
    )
  }

  async function handleExcluirOperacao() {
    if (!confirmExclusao) return
    setExcluindo(true)
    const { sucesso, erro } = await excluirOperacao(confirmExclusao.id, nomeUsuario)
    setExcluindo(false)
    setConfirmExclusao(null)
    if (!sucesso) {
      setFeedback({ tipo: 'error', texto: erro || 'Não foi possível excluir a operação.' })
      return
    }
    setFeedback({ tipo: 'success', texto: `Operação de "${confirmExclusao.nome_motorista}" movida para a Lixeira.` })
    carregarOperacoes({ forcar: true })
  }

  function handleFotoSalva(operacaoSalva) {
    setFotoAberto(false)
    setFeedback({
      texto: `Operação de "${operacaoSalva.nome_motorista}" criada via foto. Complete os demais campos editando a operação.`,
    })
    listarMotoristasComOperacao().then((r) => { if (!r.erro) setMotoristasDisponiveis(r.dados) })
    carregarOperacoes({ forcar: true })
  }

  function abrirNovaOperacao() {
    setOperacaoEditando(null)
    setFormAberto(true)
  }

  function abrirEdicaoOperacao(operacao) {
    setOperacaoEditando(operacao)
    setFormAberto(true)
  }

  function handleOperacaoSalva(operacaoSalva) {
    setFormAberto(false)
    setFeedback({
      texto: operacaoEditando
        ? `Operação de "${operacaoSalva.nome_motorista}" atualizada com sucesso.`
        : `Operação de "${operacaoSalva.nome_motorista}" criada com sucesso.`,
    })
    setOperacaoEditando(null)
    // Atualiza também a lista de motoristas do filtro, caso seja a
    // primeira operação de um motorista recém-incluído
    listarMotoristasComOperacao().then((resultado) => {
      if (!resultado.erro) setMotoristasDisponiveis(resultado.dados)
    })
    carregarOperacoes({ forcar: true })
  }

  function limparFiltros() {
    setBusca('')
    setDataOperacao('')
    setMotoristaId('')
    setTipoOperacao('')
    setStatus('')
    setRota('')
    setPlaca('')
  }

  const temFiltroAtivo = !!(busca || dataOperacao || motoristaId || tipoOperacao || status || rota || placa)

  return (
    <div>
      <div className="op-toolbar">
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Operação do Dia</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" icon={IconFileText} onClick={() => setFotoAberto(true)}>
            Importar por foto
          </Button>
          {podeCriar && (
            <Button variant="primary" icon={IconPlus} onClick={abrirNovaOperacao}>
              Nova Operação
            </Button>
          )}
        </div>
      </div>

      <div className="op-filters-card">
        <div className="op-filters-grid">
          <div className="op-field" style={{ gridColumn: 'span 2' }}>
            <label>Pesquisar</label>
            <div className="op-search-wrap">
              <IconSearch />
              <input
                type="text"
                placeholder="Código, motorista, rota, placa..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                aria-label="Pesquisar operações"
              />
            </div>
          </div>

          <div className="op-field">
            <label>Data</label>
            <input type="date" value={dataOperacao} onChange={(e) => setDataOperacao(e.target.value)} />
          </div>

          <div className="op-field">
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

          <div className="op-field">
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

          <div className="op-field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos</option>
              {STATUS_OPERACAO.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="op-field">
            <label>Rota</label>
            <input type="text" placeholder="Ex: DF-01" value={rota} onChange={(e) => setRota(e.target.value)} />
          </div>

          <div className="op-field">
            <label>Placa</label>
            <input type="text" placeholder="ABC1D23" value={placa} onChange={(e) => setPlaca(e.target.value)} />
          </div>

          {temFiltroAtivo && (
            <div className="op-filters-actions">
              <Button variant="ghost" size="sm" onClick={limparFiltros} style={{ width: '100%' }}>
                Limpar filtros
              </Button>
            </div>
          )}
        </div>
      </div>

      {feedback && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            background: 'var(--green-bg)',
            color: 'var(--green)',
            borderLeft: '3px solid var(--green)',
          }}
        >
          {feedback.texto}
        </div>
      )}

      <div className="op-table-card">
        {/* ---------- Tabela (desktop/tablet) ---------- */}
        <div className="op-table-wrap">
          <table className="op-table">
            <thead>
              <tr>
                {COLUNAS_TABELA.map(({ coluna, label, ordenavel }) =>
                  ordenavel ? (
                    <th
                      key={label}
                      className="sortable"
                      onClick={() => alternarOrdenacao(coluna)}
                      style={coluna === 'percentual_conclusao' ? { textAlign: 'center' } : undefined}
                    >
                      <span className={`op-th-inner${ordenacao.coluna === coluna ? ' sorted' : ''}`}>
                        {label}
                        <IconArrowUpDown />
                      </span>
                    </th>
                  ) : (
                    <th
                      key={label}
                      style={label === 'Previstas' || label === 'Realizadas' ? { textAlign: 'center' } : undefined}
                    >
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {!carregando && !erroLista && operacoes.length === 0 && (
                <tr>
                  <td colSpan={COLUNAS_TABELA.length}>
                    <EstadoVazio temFiltroAtivo={temFiltroAtivo} />
                  </td>
                </tr>
              )}

              {!carregando &&
                !erroLista &&
                operacoes.map((op) => (
                  <tr key={op.id} onClick={() => abrirEdicaoOperacao(op)}>
                    <td>{formatarDataBR(op.data_operacao)}</td>
                    <td className="op-motorista-cell">
                      {op.nome_motorista}
                      <div className="op-codigo-cell">{op.codigo_motorista}</div>
                    </td>
                    <td>{op.tipo_operacao}</td>
                    <td>{op.rota}</td>
                    <td>{op.placa || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{op.entregas_previstas}</td>
                    <td style={{ textAlign: 'center' }}>{op.entregas_realizadas}</td>
                    <td className={`op-percentual-cell ${corPercentual(op.percentual_conclusao)}`} style={{ textAlign: 'center' }}>
                      {op.percentual_conclusao}%
                    </td>
                    <td>
                      <OperacaoStatusBadge status={op.status} />
                    </td>
                    <td className="op-actualizado-cell">{formatarAtualizadoEm(op.updated_at)}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={IconEdit}
                        onClick={(e) => { e.stopPropagation(); abrirEdicaoOperacao(op) }}
                        aria-label={`Editar operação de ${op.nome_motorista}`}
                      />
                      {podeMarcarPendente && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={IconAlert}
                          onClick={(e) => { e.stopPropagation(); setOperacaoParaPendente(op) }}
                          title="Marcar como Pendente"
                          aria-label={`Marcar operação de ${op.nome_motorista} como pendente`}
                          style={{ color: 'var(--amber,#b45309)' }}
                        />
                      )}
                      {podeExcluir && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={IconTrash}
                          onClick={(e) => { e.stopPropagation(); setConfirmExclusao(op) }}
                          aria-label={`Excluir operação de ${op.nome_motorista}`}
                        />
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {carregando && <CarregandoLista />}
          {erroLista && <ErroLista mensagem={erroLista} onTentarNovamente={() => carregarOperacoes({ forcar: true })} />}
        </div>

        {/* ---------- Cards (mobile) ---------- */}
        <div className="op-cards">
          {carregando && <CarregandoLista />}
          {erroLista && <ErroLista mensagem={erroLista} onTentarNovamente={() => carregarOperacoes({ forcar: true })} />}
          {!carregando && !erroLista && operacoes.length === 0 && <EstadoVazio temFiltroAtivo={temFiltroAtivo} />}
          {!carregando &&
            !erroLista &&
            operacoes.map((op) => (
              <div key={op.id} className="op-card" onClick={() => abrirEdicaoOperacao(op)}>
                <div className="op-card-top">
                  <div>
                    <div className="op-card-motorista">{op.nome_motorista}</div>
                    <div className="op-card-codigo">
                      {op.codigo_motorista} · {formatarDataBR(op.data_operacao)}
                    </div>
                  </div>
                  <OperacaoStatusBadge status={op.status} />
                </div>
                <div className="op-card-meta">
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
                <div className="op-card-progress-row">
                  <div className="op-card-progress-bar">
                    <div
                      className="op-card-progress-fill"
                      style={{
                        width: `${op.percentual_conclusao}%`,
                        background: corBarraPercentual(op.percentual_conclusao),
                      }}
                    />
                  </div>
                  <span className={`op-percentual-cell ${corPercentual(op.percentual_conclusao)}`} style={{ fontSize: 13 }}>
                    {op.entregas_realizadas}/{op.entregas_previstas} ({op.percentual_conclusao}%)
                  </span>
                </div>
              </div>
            ))}
        </div>

        {!erroLista && (
          <Pagination pagina={pagina} porPagina={POR_PAGINA} total={total} onMudarPagina={setPagina} />
        )}
      </div>

      <Modal
        aberto={formAberto}
        titulo={operacaoEditando ? 'Editar Operação' : 'Nova Operação'}
        onFechar={() => setFormAberto(false)}
      >
        <OperacaoForm
          operacao={operacaoEditando}
          onSalvo={handleOperacaoSalva}
          onCancelar={() => setFormAberto(false)}
        />
      </Modal>

      <Modal
        aberto={fotoAberto}
        titulo="Importar pela folha operacional"
        onFechar={() => setFotoAberto(false)}
      >
        <ImportarPorFoto
          onSalvo={handleFotoSalva}
          onCancelar={() => setFotoAberto(false)}
        />
      </Modal>

      <MarcarPendenteModal
        operacao={operacaoParaPendente}
        nomeUsuario={nomeUsuario}
        onSalvo={() => {
          setOperacaoParaPendente(null)
          setFeedback({ texto: `Operação de "${operacaoParaPendente?.nome_motorista}" marcada como Pendente.` })
          carregarOperacoes({ forcar: true })
        }}
        onCancelar={() => setOperacaoParaPendente(null)}
      />

      <ConfirmDialog
        aberto={!!confirmExclusao}
        titulo="Mover para a Lixeira"
        mensagem={
          confirmExclusao
            ? `A operação de "${confirmExclusao.nome_motorista}" (${confirmExclusao.data_operacao || ''}) será movida para a Lixeira. Pode ser restaurada depois.`
            : ''
        }
        textoConfirmar="Mover para Lixeira"
        variantConfirmar="danger"
        carregando={excluindo}
        onConfirmar={handleExcluirOperacao}
        onCancelar={() => setConfirmExclusao(null)}
      />
    </div>
  )
}

function EstadoVazio({ temFiltroAtivo }) {
  return (
    <div className="op-empty">
      <IconClipboard />
      <p>
        {temFiltroAtivo
          ? 'Nenhuma operação encontrada para os filtros selecionados.'
          : 'Nenhuma operação cadastrada ainda. Clique em "Nova Operação" para começar.'}
      </p>
    </div>
  )
}

function CarregandoLista() {
  return (
    <div className="op-empty">
      <p style={{ color: 'var(--text3)' }}>Carregando operações...</p>
    </div>
  )
}

function ErroLista({ mensagem, onTentarNovamente }) {
  return (
    <div className="op-empty">
      <IconAlertCircle style={{ color: 'var(--red)' }} />
      <p style={{ color: 'var(--red)', marginBottom: 12 }}>{mensagem}</p>
      <Button variant="secondary" size="sm" onClick={onTentarNovamente}>
        Tentar novamente
      </Button>
    </div>
  )
}
