import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { podeFazer } from '../lib/permissions'
import {
  listarReentregas, criarReentregas, editarReentrega, atribuirMotorista, excluirReentrega,
  contarReentregas, uploadPrint, obterUrlPrint, parseNotasFiscais,
  STATUS_AGUARDANDO, STATUS_REGISTRADA,
} from '../lib/reentregasService'
import { listarMotoristas } from '../lib/motoristasService'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import Button from '../components/ui/Button'
import Pagination from '../components/ui/Pagination'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import {
  IconPackageSearch, IconSearch, IconPlus, IconEdit, IconTrash,
  IconPaperclip, IconImage, IconAlertCircle, IconCheck, IconX,
} from '../components/ui/Icons'
import './Reentregas.css'

const POR_PAGINA = 12

function fmtData(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function Reentregas() {
  const { usuario, perfil } = useAuth()
  const podeEditar = podeFazer('editar', perfil)
  const podeCriar = podeFazer('criar', perfil)
  const podeExcluir = podeFazer('excluir', perfil)
  const nomeUsuario = usuario?.nome || usuario?.email || 'Sistema'

  const [aba, setAba] = useState('registradas')
  const [busca, setBusca] = useState('')
  const buscaD = useDebouncedValue(busca, 350)

  const [paginaReg, setPaginaReg] = useState(1)
  const [paginaAg, setPaginaAg] = useState(1)

  const [itensReg, setItensReg] = useState([])
  const [totalReg, setTotalReg] = useState(0)
  const [itensAg, setItensAg] = useState([])
  const [totalAg, setTotalAg] = useState(0)
  const [contagens, setContagens] = useState({ aguardando: 0, registradas: 0 })

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [feedback, setFeedback] = useState(null)

  const [motoristasSugeridos, setMotoristasSugeridos] = useState([])

  const [modal, setModal] = useState(null) // { modo: 'nova-registrada'|'nova-aguardando'|'atribuir'|'editar', item? }
  const [confirmExcluir, setConfirmExcluir] = useState(null)
  const [processando, setProcessando] = useState(false)

  useEffect(() => { setPaginaReg(1); setPaginaAg(1) }, [buscaD])

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    const [r1, r2, r3] = await Promise.all([
      listarReentregas({ status: STATUS_REGISTRADA, busca: buscaD, pagina: paginaReg, porPagina: POR_PAGINA }),
      listarReentregas({ status: STATUS_AGUARDANDO, busca: buscaD, pagina: paginaAg, porPagina: POR_PAGINA }),
      contarReentregas(),
    ])
    setCarregando(false)
    if (r1.erro || r2.erro) { setErro(r1.erro || r2.erro); return }
    setItensReg(r1.dados); setTotalReg(r1.total)
    setItensAg(r2.dados); setTotalAg(r2.total)
    if (!r3.erro) setContagens({ aguardando: r3.aguardando, registradas: r3.registradas })
  }, [buscaD, paginaReg, paginaAg])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => setFeedback(null), 4000)
    return () => clearTimeout(t)
  }, [feedback])

  useEffect(() => {
    listarMotoristas({ situacao: 'ativo', porPagina: 500 }).then((r) => {
      if (!r.erro) setMotoristasSugeridos(r.dados.map((m) => m.nome))
    })
  }, [])

  async function handleVerPrint(item) {
    const { url, erro: e } = await obterUrlPrint(item.print_path)
    if (e || !url) { setFeedback({ tipo: 'erro', texto: e || 'Não foi possível abrir o print.' }); return }
    window.open(url, '_blank', 'noopener')
  }

  async function handleSalvar(valores) {
    setProcessando(true)
    let printPath, printNomeArquivo
    if (valores.printFile) {
      const up = await uploadPrint(valores.printFile)
      if (up.erro) { setProcessando(false); setFeedback({ tipo: 'erro', texto: up.erro }); return }
      printPath = up.path
      printNomeArquivo = valores.printFile.name
    } else if (valores.printRemovido) {
      printPath = null
      printNomeArquivo = null
    }

    let resultado
    if (modal.modo === 'nova-registrada' || modal.modo === 'nova-aguardando') {
      const notas = parseNotasFiscais(valores.notasTexto)
      resultado = await criarReentregas({
        notas,
        motoristaAnterior: valores.motoristaAnterior,
        motoristaAtual: modal.modo === 'nova-registrada' ? valores.motoristaAtual : '',
        observacao: valores.observacao,
        printPath: printPath || null,
        printNomeArquivo,
        nomeUsuario,
      })
    } else if (modal.modo === 'atribuir') {
      resultado = await atribuirMotorista({
        id: modal.item.id,
        motoristaAnterior: valores.motoristaAnterior,
        motoristaAtual: valores.motoristaAtual,
        observacao: valores.observacao,
        printPath, printNomeArquivo,
        nomeUsuario,
      })
    } else if (modal.modo === 'editar') {
      resultado = await editarReentrega({
        id: modal.item.id,
        motoristaAnterior: valores.motoristaAnterior,
        motoristaAtual: valores.motoristaAtual,
        observacao: valores.observacao,
        printPath, printNomeArquivo,
        removerPrint: valores.printRemovido,
        nomeUsuario,
      })
    }

    setProcessando(false)
    if (resultado?.erro) { setFeedback({ tipo: 'erro', texto: resultado.erro }); return }

    const mensagens = {
      'nova-registrada': `${parseNotasFiscais(valores.notasTexto).length} nota(s) registrada(s).`,
      'nova-aguardando': `${parseNotasFiscais(valores.notasTexto).length} nota(s) registrada(s) aguardando motorista.`,
      atribuir: `Nota ${modal.item.nota_fiscal} movida para "Reentregas registradas".`,
      editar: `Nota ${modal.item.nota_fiscal} atualizada.`,
    }
    setFeedback({ tipo: 'ok', texto: mensagens[modal.modo] })
    setModal(null)
    if (modal.modo === 'atribuir') setPaginaAg(1)
    if (modal.modo === 'nova-registrada' || modal.modo === 'nova-aguardando') { setPaginaReg(1); setPaginaAg(1) }
    carregar()
  }

  async function handleExcluir() {
    if (!confirmExcluir) return
    setProcessando(true)
    const { erro: e } = await excluirReentrega(confirmExcluir.id, nomeUsuario)
    setProcessando(false)
    setConfirmExcluir(null)
    if (e) { setFeedback({ tipo: 'erro', texto: e }); return }
    setFeedback({ tipo: 'ok', texto: `Nota ${confirmExcluir.nota_fiscal} excluída.` })
    carregar()
  }

  const buscaAtiva = buscaD.trim().length > 0

  return (
    <div className="rt-page">
      <div className="rt-header">
        <div className="rt-header-icon"><IconPackageSearch width={22} height={22} /></div>
        <div>
          <h2 className="rt-titulo">Reentregas</h2>
          <p className="rt-subtitulo">Notas fiscais realinhadas pelo SAC com outro motorista — motorista anterior, motorista atual e, se quiser, o print da conversa.</p>
        </div>
      </div>

      <div className="rt-busca-wrap">
        <IconSearch className="rt-busca-icon" />
        <input
          className="rt-busca"
          placeholder="Buscar pelo número da nota fiscal…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          autoComplete="off"
        />
      </div>

      {feedback && <div className={`rt-feedback rt-feedback-${feedback.tipo}`}>{feedback.texto}</div>}

      <div className="rt-tabs">
        <button className={`rt-tab${aba === 'registradas' ? ' ativa' : ''}`} onClick={() => setAba('registradas')}>
          Reentregas registradas <span className="rt-tab-cnt">{contagens.registradas}</span>
        </button>
        <button className={`rt-tab${aba === 'aguardando' ? ' ativa' : ''}`} onClick={() => setAba('aguardando')}>
          Aguardando motorista <span className={`rt-tab-cnt${contagens.aguardando > 0 ? ' tem' : ''}`}>{contagens.aguardando}</span>
        </button>
      </div>

      {aba === 'registradas' ? (
        <div>
          <div className="rt-toolbar">
            <p>Notas já com motorista definido para a reentrega, com data do alinhamento.</p>
            {podeCriar && (
              <Button variant="primary" icon={IconPlus} onClick={() => setModal({ modo: 'nova-registrada' })}>
                Nova reentrega
              </Button>
            )}
          </div>
          <div className="rt-card">
            <div className="rt-table-wrap">
              <table className="rt-table">
                <thead>
                  <tr>
                    <th>Nota fiscal</th><th>Motorista anterior → atual</th><th>Alinhado em</th>
                    <th>Print</th><th>Observação</th><th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {carregando && <tr><td colSpan={6} className="rt-msg">Carregando...</td></tr>}
                  {!carregando && erro && <tr><td colSpan={6}><div className="rt-erro-linha"><IconAlertCircle width={14} />{erro}</div></td></tr>}
                  {!carregando && !erro && itensReg.length === 0 && (
                    <tr><td colSpan={6} className="rt-msg">{buscaAtiva ? 'Nenhuma reentrega encontrada para essa busca.' : 'Nenhuma reentrega registrada ainda.'}</td></tr>
                  )}
                  {!carregando && !erro && itensReg.map((item) => (
                    <tr key={item.id} className={buscaAtiva ? 'match' : ''}>
                      <td><span className="nf-chip">{item.nota_fiscal}</span></td>
                      <td>
                        <div className="mot-flow">
                          {item.motorista_anterior} <span className="arrow">→</span> <span className="mot-atual">{item.motorista_atual}</span>
                        </div>
                      </td>
                      <td className="rt-data-cel">{fmtData(item.data_alinhamento)}</td>
                      <td>
                        {item.print_path
                          ? <button className="print-pill" onClick={() => handleVerPrint(item)}><IconPaperclip width={12} height={12} />ver print</button>
                          : <span className="print-none">— sem print —</span>}
                      </td>
                      <td><div className="obs-cell" title={item.observacao || ''}>{item.observacao || <span className="rt-vazio">—</span>}</div></td>
                      <td>
                        <div className="acoes-cell">
                          {podeEditar && <Button variant="ghost" size="sm" icon={IconEdit} title="Editar" onClick={() => setModal({ modo: 'editar', item })} />}
                          {podeExcluir && <Button variant="ghost" size="sm" icon={IconTrash} title="Excluir" style={{ color: 'var(--red)' }} onClick={() => setConfirmExcluir(item)} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!erro && <Pagination pagina={paginaReg} porPagina={POR_PAGINA} total={totalReg} onMudarPagina={setPaginaReg} />}
          </div>
        </div>
      ) : (
        <div>
          <div className="rt-toolbar">
            <p>Notas que o SAC já sinalizou como possível reentrega, mas o motorista ainda não foi definido.</p>
            {podeCriar && (
              <Button variant="primary" icon={IconPlus} onClick={() => setModal({ modo: 'nova-aguardando' })}>
                Registrar possível reentrega
              </Button>
            )}
          </div>
          <div className="rt-card">
            <div className="rt-table-wrap">
              <table className="rt-table">
                <thead>
                  <tr>
                    <th>Nota fiscal</th><th>Motorista anterior</th><th>Registrado em</th>
                    <th>Print</th><th>Observação</th><th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {carregando && <tr><td colSpan={6} className="rt-msg">Carregando...</td></tr>}
                  {!carregando && erro && <tr><td colSpan={6}><div className="rt-erro-linha"><IconAlertCircle width={14} />{erro}</div></td></tr>}
                  {!carregando && !erro && itensAg.length === 0 && (
                    <tr><td colSpan={6} className="rt-msg">{buscaAtiva ? 'Nenhuma nota encontrada para essa busca.' : 'Nenhuma nota aguardando motorista.'}</td></tr>
                  )}
                  {!carregando && !erro && itensAg.map((item) => (
                    <tr key={item.id} className={buscaAtiva ? 'match' : ''}>
                      <td><span className="nf-chip">{item.nota_fiscal}</span></td>
                      <td>{item.motorista_anterior}</td>
                      <td className="rt-data-cel">{fmtData(item.created_at)}</td>
                      <td>
                        {item.print_path
                          ? <button className="print-pill" onClick={() => handleVerPrint(item)}><IconPaperclip width={12} height={12} />ver print</button>
                          : <span className="print-none">— sem print —</span>}
                      </td>
                      <td><div className="obs-cell" title={item.observacao || ''}>{item.observacao || <span className="rt-vazio">—</span>}</div></td>
                      <td>
                        <div className="acoes-cell">
                          {podeEditar && <Button variant="secondary" size="sm" onClick={() => setModal({ modo: 'atribuir', item })}>Atribuir motorista</Button>}
                          {podeExcluir && <Button variant="ghost" size="sm" icon={IconTrash} title="Excluir" style={{ color: 'var(--red)' }} onClick={() => setConfirmExcluir(item)} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!erro && <Pagination pagina={paginaAg} porPagina={POR_PAGINA} total={totalAg} onMudarPagina={setPaginaAg} />}
          </div>
        </div>
      )}

      {modal && (
        <ReentregaFormModal
          modo={modal.modo}
          item={modal.item}
          motoristasSugeridos={motoristasSugeridos}
          processando={processando}
          onSalvar={handleSalvar}
          onCancelar={() => setModal(null)}
        />
      )}

      <ConfirmDialog
        aberto={!!confirmExcluir}
        titulo="Excluir reentrega"
        mensagem={confirmExcluir ? `A nota "${confirmExcluir.nota_fiscal}" será movida para a lixeira. Deseja continuar?` : ''}
        textoConfirmar="Excluir"
        variantConfirmar="danger"
        carregando={processando}
        onConfirmar={handleExcluir}
        onCancelar={() => setConfirmExcluir(null)}
      />
    </div>
  )
}

// ── Modal de criar / editar / atribuir ────────────────────────────────────────

function ReentregaFormModal({ modo, item, motoristasSugeridos, processando, onSalvar, onCancelar }) {
  const ehCriacao = modo === 'nova-registrada' || modo === 'nova-aguardando'
  const exigeMotoristaAtual = modo === 'nova-registrada' || modo === 'atribuir' || modo === 'editar'

  const [notasTexto, setNotasTexto] = useState('')
  const [motoristaAnterior, setMotoristaAnterior] = useState(item?.motorista_anterior || '')
  const [motoristaAtual, setMotoristaAtual] = useState(item?.motorista_atual || '')
  const [observacao, setObservacao] = useState(item?.observacao || '')
  const [erroCampo, setErroCampo] = useState('')

  // Print: pode ser um arquivo novo (recém colado/selecionado) ou o existente do item (via URL assinada)
  const [printFile, setPrintFile] = useState(null)
  const [printPreviewUrl, setPrintPreviewUrl] = useState(null)
  const [printNome, setPrintNome] = useState('')
  const [printRemovido, setPrintRemovido] = useState(false)
  const [carregandoPrintExistente, setCarregandoPrintExistente] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!item?.print_path) return
    setCarregandoPrintExistente(true)
    obterUrlPrint(item.print_path).then(({ url }) => {
      setCarregandoPrintExistente(false)
      if (url) { setPrintPreviewUrl(url); setPrintNome(item.print_nome_arquivo || 'print.png') }
    })
  }, [item])

  function aplicarArquivo(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setErroCampo('Envie uma imagem (print de tela).'); return }
    setErroCampo('')
    setPrintFile(file)
    setPrintPreviewUrl(URL.createObjectURL(file))
    setPrintNome(file.name || 'print-colado.png')
    setPrintRemovido(false)
  }

  function removerPrint() {
    setPrintFile(null)
    setPrintPreviewUrl(null)
    setPrintNome('')
    setPrintRemovido(true)
  }

  // Cola direto da área de transferência — não precisa salvar a imagem antes
  useEffect(() => {
    function aoColar(e) {
      const itens = e.clipboardData?.items || []
      for (const it of itens) {
        if (it.type && it.type.startsWith('image/')) {
          aplicarArquivo(it.getAsFile())
          e.preventDefault()
          break
        }
      }
    }
    document.addEventListener('paste', aoColar)
    return () => document.removeEventListener('paste', aoColar)
  }, [])

  const notasPreview = ehCriacao ? parseNotasFiscais(notasTexto) : []

  function validar() {
    if (ehCriacao && notasPreview.length === 0) return 'Informe ao menos uma nota fiscal.'
    if (!motoristaAnterior.trim()) return 'Informe o motorista anterior.'
    if (exigeMotoristaAtual && !motoristaAtual.trim()) return 'Informe o motorista atual.'
    return ''
  }

  function handleSalvarClick() {
    const msg = validar()
    if (msg) { setErroCampo(msg); return }
    onSalvar({ notasTexto, motoristaAnterior, motoristaAtual, observacao, printFile, printRemovido })
  }

  const titulos = {
    'nova-registrada': ['Nova reentrega', 'Você já sabe quem vai levar a reentrega.'],
    'nova-aguardando': ['Registrar possível reentrega', 'O motorista ainda não foi definido — tudo bem, você edita depois.'],
    atribuir: ['Atribuir motorista', 'Confirme quem vai levar esta reentrega.'],
    editar: ['Editar reentrega', 'Ajuste os dados desta nota.'],
  }
  const [titulo, subtitulo] = titulos[modo]

  return (
    <Modal aberto titulo={titulo} onFechar={onCancelar}>
      <p className="rt-modal-sub">{subtitulo}</p>
      <div className="rt-form">
        {ehCriacao ? (
          <div className="rt-field">
            <label className="rt-field-label">Nota(s) fiscal(is) <span className="req">*</span></label>
            <textarea rows={2} placeholder="Ex: 48211, 48212, 48213" value={notasTexto} onChange={(e) => setNotasTexto(e.target.value)} />
            <div className="rt-field-hint">Cole vários números separados por vírgula, espaço ou linha — uma reentrega é criada para cada um, todas com o mesmo motorista e o mesmo print.</div>
            {notasPreview.length > 0 && (
              <div className="nf-preview">
                {notasPreview.slice(0, 8).map((n) => <span key={n} className="nf-chip">{n}</span>)}
                {notasPreview.length > 8 && <span className="nf-more">+{notasPreview.length - 8}</span>}
              </div>
            )}
          </div>
        ) : (
          <div className="rt-field">
            <label className="rt-field-label">Nota fiscal</label>
            <span className="nf-chip" style={{ alignSelf: 'flex-start' }}>{item.nota_fiscal}</span>
          </div>
        )}

        <div className="rt-field">
          <label className="rt-field-label">Motorista anterior <span className="req">*</span></label>
          <input type="text" list="rt-lista-motoristas" placeholder="Quem estava com a entrega" autoComplete="off"
            value={motoristaAnterior} onChange={(e) => setMotoristaAnterior(e.target.value)} />
        </div>

        {exigeMotoristaAtual ? (
          <div className="rt-field">
            <label className="rt-field-label">Motorista atual <span className="req">*</span></label>
            <input type="text" list="rt-lista-motoristas" placeholder="Quem vai levar a reentrega" autoComplete="off"
              value={motoristaAtual} onChange={(e) => setMotoristaAtual(e.target.value)} />
          </div>
        ) : (
          <div className="rt-aviso-sem-motorista">
            <IconAlertCircle width={15} height={15} />
            Sem motorista ainda? Sem problema — você define depois em &ldquo;Aguardando motorista → Atribuir motorista&rdquo;.
          </div>
        )}

        <datalist id="rt-lista-motoristas">
          {motoristasSugeridos.map((nome) => <option key={nome} value={nome} />)}
        </datalist>

        <div className="rt-field">
          <label className="rt-field-label">Observação</label>
          <textarea rows={2} placeholder="Algum detalhe a mais do que o SAC combinou…" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </div>

        <div className="rt-field">
          <label className="rt-field-label">Print da conversa <span className="badge-opcional">Opcional</span></label>

          {printPreviewUrl ? (
            <div className="print-preview">
              <img src={printPreviewUrl} alt="Print anexado" />
              <div>
                <div className="pp-nome">{printNome}</div>
                <div className="pp-meta">{printFile ? 'Anexado agora' : 'Já salvo nesta nota'}</div>
              </div>
              <Button variant="ghost" size="sm" icon={IconX} title="Remover print" onClick={removerPrint} />
            </div>
          ) : (
            <div
              className={`print-zone${arrastando ? ' drag' : ''}`}
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
              onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => { e.preventDefault(); setArrastando(false); aplicarArquivo(e.dataTransfer.files?.[0]) }}
            >
              <IconImage width={24} height={24} />
              {carregandoPrintExistente ? (
                <div className="pz-title">Carregando print salvo…</div>
              ) : (
                <>
                  <div className="pz-title">Copie o print da conversa e pressione Ctrl+V aqui</div>
                  <div className="pz-sub">Direto da área de transferência — não precisa salvar a imagem em arquivo antes.</div>
                  <div className="pz-sub2">Ou arraste a imagem aqui, ou clique para escolher um arquivo. Anexar nunca é obrigatório.</div>
                </>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(e) => aplicarArquivo(e.target.files?.[0])} />
            </div>
          )}
        </div>

        {erroCampo && <div className="rt-erro-linha"><IconAlertCircle width={14} />{erroCampo}</div>}
      </div>
      <div className="modal-actions">
        <Button variant="ghost" onClick={onCancelar} disabled={processando} style={{ flex: 1 }}>Cancelar</Button>
        <Button variant="primary" icon={IconCheck} carregando={processando} onClick={handleSalvarClick} style={{ flex: 2 }}>Salvar</Button>
      </div>
    </Modal>
  )
}
