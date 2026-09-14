import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  listarLixeira,
  restaurarDaLixeira,
  excluirDefinitivamente,
  MODULOS_LIXEIRA,
  LABEL_MODULO,
} from '../lib/lixeiraService'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import Button from '../components/ui/Button'
import Pagination from '../components/ui/Pagination'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import {
  IconSearch,
  IconTrash2,
  IconRefreshCw,
  IconEye2,
  IconAlertCircle,
  IconFilter,
} from '../components/ui/Icons'
import './Lixeira.css'

const POR_PAGINA = 20

function formatarData(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function JsonViewer({ dados }) {
  if (!dados) return <p style={{ color: 'var(--text3)' }}>Sem dados.</p>
  return (
    <pre style={{
      background: 'var(--bg3)',
      borderRadius: 'var(--radius2)',
      padding: 12,
      fontSize: 12,
      overflowX: 'auto',
      maxHeight: 400,
      color: 'var(--text2)',
      lineHeight: 1.6,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      {JSON.stringify(dados, null, 2)}
    </pre>
  )
}

export default function Lixeira() {
  const { usuario, isAdmin } = useAuth()

  // ── Filtros ────────────────────────────────────────────────────────────────
  const [busca,      setBusca]      = useState('')
  const [modulo,     setModulo]     = useState('')
  const [usuarioFiltro, setUsuarioFiltro] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim,    setDataFim]    = useState('')
  const [pagina,     setPagina]     = useState(1)
  const buscaDebounced = useDebouncedValue(busca, 350)
  const usuarioDebounced = useDebouncedValue(usuarioFiltro, 350)

  // ── Dados ──────────────────────────────────────────────────────────────────
  const [itens,      setItens]      = useState([])
  const [total,      setTotal]      = useState(0)
  const [carregando, setCarreg]     = useState(true)
  const [erroLista,  setErroLista]  = useState('')

  // ── Modais ─────────────────────────────────────────────────────────────────
  const [visualizando,   setVisualizando]   = useState(null)   // item completo
  const [confirmRestaura,setConfirmRestaura]= useState(null)
  const [confirmExclui,  setConfirmExclui]  = useState(null)
  const [processando,    setProcessando]    = useState(false)
  const [feedback,       setFeedback]       = useState(null)

  const carregar = useCallback(async () => {
    setCarreg(true); setErroLista('')
    const res = await listarLixeira({
      modulo,
      busca:      buscaDebounced,
      usuario:    usuarioDebounced,
      dataInicio,
      dataFim,
      pagina,
      porPagina:  POR_PAGINA,
    })
    setCarreg(false)
    if (res.erro) { setErroLista(res.erro); return }
    setItens(res.dados); setTotal(res.total)
  }, [modulo, buscaDebounced, usuarioDebounced, dataInicio, dataFim, pagina])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => setFeedback(null), 4000)
    return () => clearTimeout(t)
  }, [feedback])

  // reset página ao mudar filtros
  useEffect(() => { setPagina(1) }, [modulo, buscaDebounced, usuarioDebounced, dataInicio, dataFim])

  async function handleRestaurar() {
    if (!confirmRestaura) return
    setProcessando(true)
    const { erro, aviso } = await restaurarDaLixeira(confirmRestaura)
    setProcessando(false)
    setConfirmRestaura(null)
    if (erro) { setFeedback({ tipo: 'error', texto: erro }); return }
    setFeedback({ tipo: 'success', texto: aviso || `"${confirmRestaura.descricao}" restaurado com sucesso.` })
    carregar()
  }

  async function handleExcluirDefinitivo() {
    if (!confirmExclui) return
    setProcessando(true)
    const { erro } = await excluirDefinitivamente(confirmExclui.id)
    setProcessando(false)
    setConfirmExclui(null)
    if (erro) { setFeedback({ tipo: 'error', texto: erro }); return }
    setFeedback({ tipo: 'success', texto: `"${confirmExclui.descricao}" excluído definitivamente.` })
    carregar()
  }

  return (
    <div className="lx-page">
      {/* Cabeçalho */}
      <div className="lx-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="lx-header-icon">
            <IconTrash2 width={22} height={22} />
          </div>
          <div>
            <h2 className="lx-titulo">Lixeira</h2>
            <p className="lx-subtitulo">
              Registros excluídos das telas da plataforma. Restaure ou exclua definitivamente.
              {isAdmin && <span className="lx-badge-admin">Exclusão definitiva habilitada</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`lx-feedback lx-feedback-${feedback.tipo}`}>
          {feedback.tipo === 'error' && <IconAlertCircle width={15} />}
          {feedback.texto}
        </div>
      )}

      {/* Filtros */}
      <div className="lx-filtros">
        <div className="lx-busca-wrap">
          <IconSearch className="lx-busca-icon" />
          <input
            className="lx-busca-input"
            type="text"
            placeholder="Buscar na descrição..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
        </div>
        <select className="lx-select" value={modulo} onChange={e => setModulo(e.target.value)}>
          <option value="">Todos os módulos</option>
          {MODULOS_LIXEIRA.map(m => (
            <option key={m.valor} value={m.valor}>{m.label}</option>
          ))}
        </select>
        <input
          className="lx-input-filtro"
          type="text"
          placeholder="Excluído por..."
          value={usuarioFiltro}
          onChange={e => setUsuarioFiltro(e.target.value)}
        />
        <input
          className="lx-input-filtro lx-input-data"
          type="date"
          value={dataInicio}
          onChange={e => setDataInicio(e.target.value)}
          title="Data início"
        />
        <span className="lx-filtro-sep">até</span>
        <input
          className="lx-input-filtro lx-input-data"
          type="date"
          value={dataFim}
          onChange={e => setDataFim(e.target.value)}
          title="Data fim"
        />
        {(modulo || busca || usuarioFiltro || dataInicio || dataFim) && (
          <button
            className="lx-btn-limpar"
            onClick={() => { setModulo(''); setBusca(''); setUsuarioFiltro(''); setDataInicio(''); setDataFim('') }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="lx-card">
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>Módulo</th>
                <th>Descrição</th>
                <th>Excluído por</th>
                <th>Data exclusão</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr><td colSpan={5} className="lx-estado-central">Carregando...</td></tr>
              )}
              {!carregando && erroLista && (
                <tr>
                  <td colSpan={5}>
                    <div className="lx-erro"><IconAlertCircle width={15} />{erroLista}</div>
                  </td>
                </tr>
              )}
              {!carregando && !erroLista && itens.length === 0 && (
                <tr>
                  <td colSpan={5} className="lx-estado-central">
                    {modulo || busca || usuarioFiltro || dataInicio || dataFim
                      ? 'Nenhum item encontrado para os filtros selecionados.'
                      : 'A lixeira está vazia.'}
                  </td>
                </tr>
              )}
              {!carregando && !erroLista && itens.map(item => (
                <tr key={item.id}>
                  <td>
                    <span className="lx-badge-modulo">
                      {LABEL_MODULO[item.tabela_origem] ?? item.tabela_origem}
                    </span>
                  </td>
                  <td className="lx-td-descricao" title={item.descricao}>{item.descricao}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text3)' }}>{item.usuario_exclusao}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                    {formatarData(item.data_exclusao)}
                  </td>
                  <td>
                    <div className="lx-acoes">
                      <Button
                        variant="ghost" size="sm" icon={IconEye2}
                        onClick={() => setVisualizando(item)}
                        title="Visualizar dados"
                      />
                      <Button
                        variant="ghost" size="sm" icon={IconRefreshCw}
                        onClick={() => setConfirmRestaura(item)}
                        title="Restaurar"
                        style={{ color: 'var(--green)' }}
                      />
                      {isAdmin && (
                        <Button
                          variant="ghost" size="sm" icon={IconTrash2}
                          onClick={() => setConfirmExclui(item)}
                          title="Excluir definitivamente"
                          style={{ color: 'var(--red)' }}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!erroLista && (
          <Pagination pagina={pagina} porPagina={POR_PAGINA} total={total} onMudarPagina={setPagina} />
        )}
      </div>

      {/* Modal: visualizar dados */}
      <Modal
        aberto={!!visualizando}
        titulo={`Dados: ${visualizando?.descricao?.slice(0, 60) ?? ''}${(visualizando?.descricao?.length ?? 0) > 60 ? '…' : ''}`}
        onFechar={() => setVisualizando(null)}
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 13, color: 'var(--text2)' }}>
            <span><strong>Módulo:</strong> {LABEL_MODULO[visualizando?.tabela_origem] ?? visualizando?.tabela_origem}</span>
            <span><strong>Excluído por:</strong> {visualizando?.usuario_exclusao}</span>
            <span><strong>Em:</strong> {formatarData(visualizando?.data_exclusao)}</span>
          </div>
          <JsonViewer dados={visualizando?.dados_json} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => setVisualizando(null)} style={{ flex: 1 }}>
            Fechar
          </Button>
          <Button
            variant="secondary"
            onClick={() => { setVisualizando(null); setConfirmRestaura(visualizando) }}
            style={{ flex: 1, color: 'var(--green)', borderColor: 'var(--green)' }}
            icon={IconRefreshCw}
          >
            Restaurar
          </Button>
        </div>
      </Modal>

      {/* Confirmar restauração */}
      <ConfirmDialog
        aberto={!!confirmRestaura}
        titulo="Restaurar registro"
        mensagem={`Deseja restaurar "${confirmRestaura?.descricao ?? ''}" de volta ao sistema? O registro será reinserido exatamente como estava antes da exclusão.`}
        textoConfirmar="Restaurar"
        variantConfirmar="primary"
        carregando={processando}
        onConfirmar={handleRestaurar}
        onCancelar={() => setConfirmRestaura(null)}
      />

      {/* Confirmar exclusão definitiva */}
      <ConfirmDialog
        aberto={!!confirmExclui}
        titulo="Excluir definitivamente"
        mensagem={`Tem certeza? "${confirmExclui?.descricao ?? ''}" será removido PERMANENTEMENTE. Esta ação não pode ser desfeita.`}
        textoConfirmar="Excluir definitivamente"
        variantConfirmar="danger"
        carregando={processando}
        onConfirmar={handleExcluirDefinitivo}
        onCancelar={() => setConfirmExclui(null)}
      />
    </div>
  )
}
