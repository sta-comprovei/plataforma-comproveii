import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listarMotoristas,
  definirSituacaoMotorista,
  excluirMotorista,
} from '../lib/motoristasService'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { formatarCPF } from '../lib/cpfUtils'

import { useAuth } from '../contexts/AuthContext'
import { podeFazer } from '../lib/permissions'
import Button from '../components/ui/Button'
import StatusBadge from '../components/ui/StatusBadge'
import Pagination from '../components/ui/Pagination'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import {
  IconSearch,
  IconPlus,
  IconEdit,
  IconTrash,
  IconCheck,
  IconBan,
  IconArrowUpDown,
  IconTruck,
  IconAlertCircle,
} from '../components/ui/Icons'

import MotoristaForm from './MotoristaForm'
import MotoristaPerfilModal from './MotoristaPerfilModal'
import './Motoristas.css'

const POR_PAGINA = 10

const COLUNAS_ORDENAVEIS = [
  { coluna: 'codigo', label: 'Código' },
  { coluna: 'nome', label: 'Nome' },
]

export default function Motoristas() {
  const { usuario, perfil } = useAuth()
  const podeCriar   = podeFazer('criar',   perfil)
  const podeEditar  = podeFazer('editar',  perfil)
  const podeExcluir = podeFazer('excluir', perfil)
  // ---- estado de listagem ----
  const [busca, setBusca] = useState('')
  const buscaDebounced = useDebouncedValue(busca, 350)
  const [situacao, setSituacao] = useState('todos') // todos | ativo | inativo
  const [ordenacao, setOrdenacao] = useState({ coluna: 'nome', direcao: 'asc' })
  const [pagina, setPagina] = useState(1)

  const [motoristas, setMotoristas] = useState([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erroLista, setErroLista] = useState('')

  // ---- estado de modais ----
  const [formAberto, setFormAberto] = useState(false)
  const [motoristaEditando, setMotoristaEditando] = useState(null)
  const [motoristaPerfil, setMotoristaPerfil] = useState(null)
  const [confirmacao, setConfirmacao] = useState(null) // { tipo, motorista }
  const [processandoAcao, setProcessandoAcao] = useState(false)
  const [feedback, setFeedback] = useState(null) // { tipo: 'success'|'error', texto }

  // Rastreia a última combinação de busca+situação para detectar mudança de
  // filtro e resetar a página ANTES de disparar a query — evita a corrida
  // entre "buscar com a página antiga" e "resetar para a página 1" que
  // gerava uma requisição extra e descartada ao Supabase a cada pesquisa.
  const filtroAnteriorRef = useRef(`${buscaDebounced}::${situacao}`)
  // Guarda a assinatura completa da última busca AUTOMÁTICA (disparada pelo
  // useEffect de busca/filtro/ordenação/página) efetivamente concluída.
  // Serve apenas para pular a chamada redundante que o setPagina(1) interno
  // provoca quando o filtro muda — nunca é usada para recargas manuais
  // explícitas (após salvar/inativar/reativar/excluir), que sempre devem
  // buscar dados novos do servidor mesmo com os mesmos parâmetros de
  // busca/página, pois o conteúdo em si mudou.
  const ultimaBuscaAutomaticaRef = useRef('')

  const carregarMotoristas = useCallback(
    async ({ forcar = false } = {}) => {
      const filtroAtual = `${buscaDebounced}::${situacao}`
      const mudouFiltro = filtroAtual !== filtroAnteriorRef.current
      const paginaEfetiva = mudouFiltro ? 1 : pagina

      const assinatura = `${filtroAtual}::${ordenacao.coluna}:${ordenacao.direcao}::${paginaEfetiva}`
      if (!forcar && assinatura === ultimaBuscaAutomaticaRef.current) {
        // Mesmos parâmetros da última busca automática já concluída — este
        // re-render foi apenas o React sincronizando 'pagina' internamente,
        // sem necessidade de refazer a requisição ao Supabase.
        return
      }

      setCarregando(true)
      setErroLista('')

      if (mudouFiltro) {
        filtroAnteriorRef.current = filtroAtual
        if (pagina !== 1) {
          // Sincroniza o estado visível da paginação; a query desta chamada
          // já está usando paginaEfetiva=1, então isso não dispara busca extra.
          setPagina(1)
        }
      }

      const resultado = await listarMotoristas({
        busca: buscaDebounced,
        situacao,
        ordenacao,
        pagina: paginaEfetiva,
        porPagina: POR_PAGINA,
      })
      setCarregando(false)
      ultimaBuscaAutomaticaRef.current = assinatura

      if (resultado.erro) {
        setErroLista(resultado.erro)
        setMotoristas([])
        setTotal(0)
        return
      }
      setMotoristas(resultado.dados)
      setTotal(resultado.total)
    },
    [buscaDebounced, situacao, ordenacao, pagina]
  )

  useEffect(() => {
    carregarMotoristas()
  }, [carregarMotoristas])

  // Some o feedback automaticamente após alguns segundos
  useEffect(() => {
    if (!feedback) return undefined
    const timer = setTimeout(() => setFeedback(null), 4500)
    return () => clearTimeout(timer)
  }, [feedback])

  function alternarOrdenacao(coluna) {
    setOrdenacao((atual) =>
      atual.coluna === coluna
        ? { coluna, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' }
        : { coluna, direcao: 'asc' }
    )
  }

  function abrirNovoMotorista() {
    setMotoristaEditando(null)
    setFormAberto(true)
  }

  function abrirEdicaoMotorista(motorista) {
    setMotoristaEditando(motorista)
    setFormAberto(true)
  }

  function handleMotoristaSalvo(motoristaSalvo) {
    setFormAberto(false)
    setFeedback({
      tipo: 'success',
      texto: motoristaEditando
        ? `Motorista "${motoristaSalvo.nome}" atualizado com sucesso.`
        : `Motorista "${motoristaSalvo.nome}" cadastrado com sucesso.`,
    })
    setMotoristaEditando(null)
    carregarMotoristas({ forcar: true })
  }

  function pedirConfirmacao(tipo, motorista) {
    setConfirmacao({ tipo, motorista })
  }

  async function executarConfirmacao() {
    if (!confirmacao) return
    const { tipo, motorista } = confirmacao
    setProcessandoAcao(true)

    let resultado
    if (tipo === 'inativar') {
      resultado = await definirSituacaoMotorista(motorista.id, false)
    } else if (tipo === 'reativar') {
      resultado = await definirSituacaoMotorista(motorista.id, true)
    } else if (tipo === 'excluir') {
      resultado = await excluirMotorista(motorista.id, usuario?.nome || usuario?.email || 'Sistema')
    }

    setProcessandoAcao(false)
    setConfirmacao(null)

    const erro = resultado?.erro
    if (erro) {
      setFeedback({ tipo: 'error', texto: erro })
      return
    }

    const mensagens = {
      inativar: `Motorista "${motorista.nome}" inativado.`,
      reativar: `Motorista "${motorista.nome}" reativado.`,
      excluir: `Motorista "${motorista.nome}" excluído permanentemente.`,
    }
    setFeedback({ tipo: 'success', texto: mensagens[tipo] })
    carregarMotoristas({ forcar: true })
  }

  const configConfirmacao = {
    inativar: {
      titulo: 'Inativar motorista',
      mensagem: (m) => `Tem certeza que deseja inativar "${m.nome}"? Ele deixará de aparecer como opção em novas operações, mas o histórico é preservado.`,
      textoConfirmar: 'Inativar',
      variant: 'danger',
    },
    reativar: {
      titulo: 'Reativar motorista',
      mensagem: (m) => `Deseja reativar "${m.nome}"? Ele voltará a ficar disponível para novas operações.`,
      textoConfirmar: 'Reativar',
      variant: 'primary',
    },
    excluir: {
      titulo: 'Excluir motorista permanentemente',
      mensagem: (m) =>
        `Esta ação não pode ser desfeita. "${m.nome}" (código ${m.codigo}) será excluído permanentemente. Se houver operações vinculadas a este motorista, a exclusão será bloqueada — inative-o nesse caso.`,
      textoConfirmar: 'Excluir definitivamente',
      variant: 'danger',
    },
  }

  return (
    <div>
      <div className="mot-toolbar">
        <div className="mot-filters">
          <div className="mot-search-wrap">
            <IconSearch />
            <input
              type="text"
              placeholder="Pesquisar por código ou nome..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Pesquisar motorista"
            />
          </div>

          <select
            className="mot-select"
            value={situacao}
            onChange={(e) => setSituacao(e.target.value)}
            aria-label="Filtrar por situação"
          >
            <option value="todos">Todas as situações</option>
            <option value="ativo">Somente ativos</option>
            <option value="inativo">Somente inativos</option>
          </select>
        </div>

        {podeCriar && (
          <Button variant="primary" icon={IconPlus} onClick={abrirNovoMotorista}>
            Novo Motorista
          </Button>
        )}
      </div>

      {feedback && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            background: feedback.tipo === 'success' ? 'var(--green-bg)' : 'var(--red-bg)',
            color: feedback.tipo === 'success' ? 'var(--green)' : 'var(--red)',
            borderLeft: `3px solid ${feedback.tipo === 'success' ? 'var(--green)' : 'var(--red)'}`,
          }}
        >
          {feedback.texto}
        </div>
      )}

      <div className="mot-table-card">
        {/* ---------- Tabela (desktop/tablet) ---------- */}
        <div className="mot-table-wrap">
          <table className="mot-table">
            <thead>
              <tr>
                {COLUNAS_ORDENAVEIS.map(({ coluna, label }) => (
                  <th key={coluna} className="sortable" onClick={() => alternarOrdenacao(coluna)}>
                    <span className={`mot-th-inner${ordenacao.coluna === coluna ? ' sorted' : ''}`}>
                      {label}
                      <IconArrowUpDown />
                    </span>
                  </th>
                ))}
                <th>CPF</th>
                <th>Situação</th>
                <th>Cadastrado em</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {!carregando && !erroLista && motoristas.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EstadoVazio busca={buscaDebounced} situacao={situacao} />
                  </td>
                </tr>
              )}

              {!carregando &&
                !erroLista &&
                motoristas.map((m) => (
                  <tr key={m.id} className={!m.ativo ? 'row-inativo' : ''}>
                    <td className="mot-codigo-cell">{m.codigo}</td>
                    <td className="mot-nome-cell">
                      <button
                        type="button"
                        onClick={() => setMotoristaPerfil(m)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          font: 'inherit',
                          fontWeight: 600,
                          color: 'var(--text)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                        title="Ver perfil e indicadores de Lead Time"
                      >
                        {m.nome}
                      </button>
                    </td>
                    <td>{m.cpf ? formatarCPF(m.cpf) : '—'}</td>
                    <td>
                      <StatusBadge ativo={m.ativo} />
                    </td>
                    <td style={{ color: 'var(--text3)', fontSize: 12.5 }}>
                      {new Date(m.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td>
                      <div className="mot-actions-cell">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={IconEdit}
                          onClick={() => podeEditar && abrirEdicaoMotorista(m)}
                          aria-label={`Editar ${m.nome}`}
                          disabled={!podeEditar}
                        />
                        {m.ativo ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={IconBan}
                            onClick={() => pedirConfirmacao('inativar', m)}
                            aria-label={`Inativar ${m.nome}`}
                          />
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={IconCheck}
                            onClick={() => pedirConfirmacao('reativar', m)}
                            aria-label={`Reativar ${m.nome}`}
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={IconTrash}
                          onClick={() => podeExcluir && pedirConfirmacao('excluir', m)}
                          disabled={!podeExcluir}
                          aria-label={`Excluir ${m.nome}`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {carregando && <CarregandoLista />}
          {erroLista && <ErroLista mensagem={erroLista} onTentarNovamente={() => carregarMotoristas({ forcar: true })} />}
        </div>

        {/* ---------- Cards (mobile) ---------- */}
        <div className="mot-cards">
          {carregando && <CarregandoLista />}
          {erroLista && <ErroLista mensagem={erroLista} onTentarNovamente={() => carregarMotoristas({ forcar: true })} />}
          {!carregando && !erroLista && motoristas.length === 0 && (
            <EstadoVazio busca={buscaDebounced} situacao={situacao} />
          )}
          {!carregando &&
            !erroLista &&
            motoristas.map((m) => (
              <div key={m.id} className="mot-card">
                <div className="mot-card-top">
                  <div>
                    <div className="mot-card-codigo">{m.codigo}</div>
                    <button
                      type="button"
                      className="mot-card-nome"
                      onClick={() => setMotoristaPerfil(m)}
                      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                      title="Ver perfil e indicadores de Lead Time"
                    >
                      {m.nome}
                    </button>
                    {m.cpf && <div className="mot-card-cpf">{formatarCPF(m.cpf)}</div>}
                  </div>
                  <StatusBadge ativo={m.ativo} />
                </div>
                <div className="mot-card-actions">
                  <Button variant="ghost" size="sm" icon={IconEdit} onClick={() => abrirEdicaoMotorista(m)}>
                    Editar
                  </Button>
                  {m.ativo ? (
                    <Button variant="ghost" size="sm" icon={IconBan} onClick={() => pedirConfirmacao('inativar', m)}>
                      Inativar
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" icon={IconCheck} onClick={() => pedirConfirmacao('reativar', m)}>
                      Reativar
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={IconTrash}
                    onClick={() => pedirConfirmacao('excluir', m)}
                    aria-label={`Excluir ${m.nome}`}
                  />
                </div>
              </div>
            ))}
        </div>

        {!erroLista && (
          <Pagination pagina={pagina} porPagina={POR_PAGINA} total={total} onMudarPagina={setPagina} />
        )}
      </div>

      <MotoristaForm
        aberto={formAberto}
        motorista={motoristaEditando}
        onFechar={() => setFormAberto(false)}
        onSalvo={handleMotoristaSalvo}
      />

      <ConfirmDialog
        aberto={!!confirmacao}
        titulo={confirmacao ? configConfirmacao[confirmacao.tipo].titulo : ''}
        mensagem={confirmacao ? configConfirmacao[confirmacao.tipo].mensagem(confirmacao.motorista) : ''}
        textoConfirmar={confirmacao ? configConfirmacao[confirmacao.tipo].textoConfirmar : ''}
        variantConfirmar={confirmacao ? configConfirmacao[confirmacao.tipo].variant : 'danger'}
        carregando={processandoAcao}
        onConfirmar={executarConfirmacao}
        onCancelar={() => setConfirmacao(null)}
      />

      <MotoristaPerfilModal motorista={motoristaPerfil} onFechar={() => setMotoristaPerfil(null)} />
    </div>
  )
}

function EstadoVazio({ busca, situacao }) {
  let texto = 'Nenhum motorista cadastrado ainda.'
  if (busca) {
    texto = `Nenhum motorista encontrado para "${busca}".`
  } else if (situacao !== 'todos') {
    texto = `Nenhum motorista ${situacao === 'ativo' ? 'ativo' : 'inativo'} encontrado.`
  }
  return (
    <div className="mot-empty">
      <IconTruck />
      <p>{texto}</p>
    </div>
  )
}

function CarregandoLista() {
  return (
    <div className="mot-empty">
      <p style={{ color: 'var(--text3)' }}>Carregando motoristas...</p>
    </div>
  )
}

function ErroLista({ mensagem, onTentarNovamente }) {
  return (
    <div className="mot-empty">
      <IconAlertCircle style={{ color: 'var(--red)' }} />
      <p style={{ color: 'var(--red)', marginBottom: 12 }}>{mensagem}</p>
      <Button variant="secondary" size="sm" onClick={onTentarNovamente}>
        Tentar novamente
      </Button>
    </div>
  )
}
