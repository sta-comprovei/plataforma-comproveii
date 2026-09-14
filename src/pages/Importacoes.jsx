import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { podeFazer } from '../lib/permissions'
import {
  listarHistoricoImportacoes,
  processarImportacao,
  COLUNAS_POR_ORIGEM,
  ORIGENS_IMPORTACAO,
  ROTULOS_ORIGEM_IMPORTACAO,
  ROTULOS_STATUS_IMPORTACAO,
} from '../lib/importacoesService'

import Button from '../components/ui/Button'
import Pagination from '../components/ui/Pagination'
import {
  IconUpload,
  IconFileCheck,
  IconFileText,
  IconAlertCircle,
  IconUserCircle,
} from '../components/ui/Icons'

import ImportacaoDetalheModal from './ImportacaoDetalheModal'
import './Importacoes.css'

const POR_PAGINA = 15

function formatarBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatarDataHoraCurta(dataHora) {
  return new Date(dataHora).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Importacoes() {
  const { isAdmin, usuario, perfil } = useAuth()
  const podeImportar = podeFazer('importar', perfil)
  const podeExcluir  = podeFazer('excluir',  perfil)

  // ---- formulário de upload (somente admin) ----
  const [origem, setOrigem] = useState(ORIGENS_IMPORTACAO.COMPROVEI)
  const [arquivoSelecionado, setArquivoSelecionado] = useState(null)
  const [arrastandoArquivo, setArrastandoArquivo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultadoImportacao, setResultadoImportacao] = useState(null)
  const [aguardandoConfirmacaoDuplicata, setAguardandoConfirmacaoDuplicata] = useState(null)
  const inputFileRef = useRef(null)

  // Competência manual — obrigatória apenas para Desempenho de Motoristas
  const anoAtual = new Date().getFullYear()
  const [compMes, setCompMes] = useState(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [compAno, setCompAno] = useState(String(anoAtual))

  // ---- histórico ----
  const [historico, setHistorico] = useState([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [carregandoHistorico, setCarregandoHistorico] = useState(true)
  const [erroHistorico, setErroHistorico] = useState('')
  const [registroSelecionado, setRegistroSelecionado] = useState(null)

  const carregarHistorico = useCallback(async ({ forcar = false } = {}) => {
    setCarregandoHistorico(true)
    setErroHistorico('')
    const resultado = await listarHistoricoImportacoes({ pagina, porPagina: POR_PAGINA })
    setCarregandoHistorico(false)
    if (resultado.erro) {
      setErroHistorico(resultado.erro)
      setHistorico([])
      setTotal(0)
      return
    }
    setHistorico(resultado.dados)
    setTotal(resultado.total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina])

  useEffect(() => {
    carregarHistorico()
  }, [carregarHistorico])

  function limparSelecao() {
    setArquivoSelecionado(null)
    setResultadoImportacao(null)
    setAguardandoConfirmacaoDuplicata(null)
    if (inputFileRef.current) inputFileRef.current.value = ''
  }

  function selecionarArquivo(file) {
    if (!file) return
    setArquivoSelecionado(file)
    setResultadoImportacao(null)
    setAguardandoConfirmacaoDuplicata(null)
  }

  function handleDrop(e) {
    e.preventDefault()
    setArrastandoArquivo(false)
    const file = e.dataTransfer.files?.[0]
    selecionarArquivo(file)
  }

  async function iniciarImportacao(confirmarDuplicata = false) {
    if (!arquivoSelecionado) return

    // Validar competência obrigatória para Desempenho de Motoristas
    if (origem === ORIGENS_IMPORTACAO.DESEMPENHO_MOTORISTAS && (!compMes || !compAno)) {
      setResultadoImportacao({ sucesso: false, erro: 'Informe a competência (mês e ano) antes de importar.' })
      return
    }

    setEnviando(true)
    setResultadoImportacao(null)

    const competencia = origem === ORIGENS_IMPORTACAO.DESEMPENHO_MOTORISTAS
      ? `${compAno}-${compMes}`
      : null

    const resultado = await processarImportacao(arquivoSelecionado, origem, confirmarDuplicata, competencia)
    setEnviando(false)

    if (!resultado.sucesso && resultado.duplicata) {
      setAguardandoConfirmacaoDuplicata(resultado)
      carregarHistorico({ forcar: true })
      return
    }

    setAguardandoConfirmacaoDuplicata(null)
    setResultadoImportacao(resultado)
    carregarHistorico({ forcar: true })
  }

  const colunasObrigatoriasOrigem = COLUNAS_POR_ORIGEM[origem] || []

  return (
    <div>
      <div className="imp-header">
        <div>
          <h2>Importações</h2>
          <p>Infraestrutura de upload e histórico para arquivos do Comprovei e da Rotina/Vendas.</p>
        </div>
      </div>

      {isAdmin ? (
        <div className="imp-upload-card">
          <h3>Nova importação</h3>
          <p className="imp-upload-sub">
            Envie um arquivo .xlsx ou .csv. Colunas obrigatórias variam conforme a origem selecionada.
          </p>

          <div className="imp-upload-grid">
            <div className="imp-field">
              <label>Origem do arquivo</label>
              <select value={origem} onChange={(e) => { setOrigem(e.target.value); limparSelecao(); setCompMes(String(new Date().getMonth() + 1).padStart(2, '0')); setCompAno(String(new Date().getFullYear())) }} disabled={enviando}>
                <option value={ORIGENS_IMPORTACAO.COMPROVEI}>Comprovei</option>
                <option value={ORIGENS_IMPORTACAO.ROTINA}>Rotina/Vendas</option>
                <option value={ORIGENS_IMPORTACAO.DESEMPENHO_MOTORISTAS}>Desempenho de Motoristas</option>
                <option value={ORIGENS_IMPORTACAO.OUTRO}>Outro</option>
              </select>
            </div>
            {colunasObrigatoriasOrigem.length > 0 && (
              <div className="imp-field">
                <label>Colunas obrigatórias</label>
                <span style={{ fontSize: 12.5, color: 'var(--text2)', paddingTop: 8 }}>
                  {colunasObrigatoriasOrigem.join(', ')}
                </span>
              </div>
            )}
            {origem === ORIGENS_IMPORTACAO.DESEMPENHO_MOTORISTAS && (
              <div className="imp-field">
                <label>
                  Competência <span style={{ color: 'var(--red)' }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={compMes}
                    onChange={(e) => setCompMes(e.target.value)}
                    disabled={enviando}
                    style={{ flex: 1 }}
                  >
                    {[
                      ['01','Janeiro'],['02','Fevereiro'],['03','Março'],
                      ['04','Abril'],['05','Maio'],['06','Junho'],
                      ['07','Julho'],['08','Agosto'],['09','Setembro'],
                      ['10','Outubro'],['11','Novembro'],['12','Dezembro'],
                    ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <select
                    value={compAno}
                    onChange={(e) => setCompAno(e.target.value)}
                    disabled={enviando}
                    style={{ width: 88 }}
                  >
                    {Array.from({ length: 5 }, (_, i) => String(anoAtual - 2 + i)).map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 3 }}>
                  Mês de referência dos dados do relatório Comprovei.
                </span>
              </div>
            )}
          </div>

          <div
            className={`imp-dropzone${arrastandoArquivo ? ' dragover' : ''}`}
            onClick={() => inputFileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setArrastandoArquivo(true) }}
            onDragLeave={() => setArrastandoArquivo(false)}
            onDrop={handleDrop}
          >
            <IconUpload style={{ margin: '0 auto' }} />
            <div className="imp-dropzone-text">Clique para selecionar ou arraste o arquivo aqui</div>
            <div className="imp-dropzone-sub">Formatos aceitos: .xlsx, .csv — máximo 20 MB</div>
            <input
              ref={inputFileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => selecionarArquivo(e.target.files?.[0])}
            />
          </div>

          {arquivoSelecionado && (
            <div className="imp-selected-file">
              <IconFileText />
              <span className="imp-selected-file-name">{arquivoSelecionado.name}</span>
              <span className="imp-selected-file-size">{formatarBytes(arquivoSelecionado.size)}</span>
            </div>
          )}

          {aguardandoConfirmacaoDuplicata && (
            <div className="imp-resultado aviso">
              <strong>Este arquivo já foi importado antes.</strong>
              <div style={{ marginTop: 4 }}>
                Importado em {new Date(aguardandoConfirmacaoDuplicata.duplicata.created_at).toLocaleDateString('pt-BR')} como
                "{aguardandoConfirmacaoDuplicata.duplicata.nome_arquivo}" ({aguardandoConfirmacaoDuplicata.duplicata.total_registros} registros).
                Deseja importar mesmo assim?
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Button variant="secondary" size="sm" carregando={enviando} onClick={() => iniciarImportacao(true)}>
                  Importar mesmo assim
                </Button>
                <Button variant="ghost" size="sm" onClick={limparSelecao} disabled={enviando}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {resultadoImportacao && (
            <div
              className={`imp-resultado ${
                resultadoImportacao.sucesso
                  ? resultadoImportacao.registro?.status === 'concluido_com_avisos'
                    ? 'aviso'
                    : 'sucesso'
                  : 'erro'
              }`}
            >
              {resultadoImportacao.erro || resultadoImportacao.registro?.mensagem_resultado}
              {resultadoImportacao.avisoFunil && (
                <div style={{ marginTop: 8, fontSize: 12.5, opacity: 0.9 }}>
                  Detalhe: {resultadoImportacao.avisoFunil}
                </div>
              )}
              {resultadoImportacao.funil && !resultadoImportacao.avisoFunil && resultadoImportacao.funil.inseridos != null && (
                <div style={{ marginTop: 8, fontSize: 12.5, opacity: 0.9 }}>
                  Registros gravados no histórico: {resultadoImportacao.funil.inseridos}
                  {resultadoImportacao.funil.ignorados > 0 && ` · Ignorados: ${resultadoImportacao.funil.ignorados}`}
                </div>
              )}
              {resultadoImportacao.registro && resultadoImportacao.registro.total_registros > 0 && (
                <div className="imp-resultado-stats">
                  <span>Total: {resultadoImportacao.registro.total_registros}</span>
                  <span>Válidos: {resultadoImportacao.registro.registros_validos}</span>
                  <span>Inválidos: {resultadoImportacao.registro.registros_invalidos}</span>
                  <span>Duplicados: {resultadoImportacao.registro.registros_duplicados_no_arquivo}</span>
                </div>
              )}
            </div>
          )}

          {!aguardandoConfirmacaoDuplicata && (
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button
                variant="primary"
                icon={IconUpload}
                disabled={!arquivoSelecionado}
                carregando={enviando}
                onClick={() => iniciarImportacao(false)}
              >
                Importar arquivo
              </Button>
              {arquivoSelecionado && (
                <Button variant="ghost" onClick={limparSelecao} disabled={enviando}>
                  Cancelar
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="imp-readonly-notice" style={{ marginBottom: 20 }}>
          <IconUserCircle />
          Você está visualizando o histórico de importações. Apenas administradores podem enviar novos arquivos.
        </div>
      )}

      <div className="imp-table-card">
        <div className="imp-table-wrap">
          <table className="imp-table">
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Data</th>
                <th>Usuário</th>
                <th>Registros</th>
                <th>Status</th>
                <th>Origem</th>
              </tr>
            </thead>
            <tbody>
              {!carregandoHistorico && !erroHistorico && historico.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EstadoVazio />
                  </td>
                </tr>
              )}
              {!carregandoHistorico &&
                !erroHistorico &&
                historico.map((h) => (
                  <tr key={h.id} onClick={() => setRegistroSelecionado(h)}>
                    <td>
                      <div className="imp-arquivo-cell">
                        <IconFileCheck />
                        <span className="imp-arquivo-nome" title={h.nome_arquivo}>{h.nome_arquivo}</span>
                      </div>
                    </td>
                    <td>{formatarDataHoraCurta(h.created_at)}</td>
                    <td>{h.nome_usuario}</td>
                    <td style={{ textAlign: 'center' }}>{h.total_registros ?? '—'}</td>
                    <td>
                      <span className={`imp-status-badge imp-status-${h.status}`}>
                        <span className="imp-status-dot" />
                        {ROTULOS_STATUS_IMPORTACAO[h.status] || h.status}
                      </span>
                    </td>
                    <td>{ROTULOS_ORIGEM_IMPORTACAO[h.origem] || h.origem}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          {carregandoHistorico && (
            <div className="imp-empty">
              <p style={{ color: 'var(--text3)' }}>Carregando histórico...</p>
            </div>
          )}
          {erroHistorico && (
            <div className="imp-empty">
              <IconAlertCircle style={{ color: 'var(--red)' }} />
              <p style={{ color: 'var(--red)', marginBottom: 12 }}>{erroHistorico}</p>
              <Button variant="secondary" size="sm" onClick={() => carregarHistorico({ forcar: true })}>
                Tentar novamente
              </Button>
            </div>
          )}
        </div>

        <div className="imp-cards">
          {carregandoHistorico && (
            <div className="imp-empty">
              <p style={{ color: 'var(--text3)' }}>Carregando histórico...</p>
            </div>
          )}
          {!carregandoHistorico && !erroHistorico && historico.length === 0 && <EstadoVazio />}
          {!carregandoHistorico &&
            !erroHistorico &&
            historico.map((h) => (
              <div key={h.id} className="imp-card" onClick={() => setRegistroSelecionado(h)}>
                <div className="imp-card-top">
                  <div className="imp-card-nome">{h.nome_arquivo}</div>
                  <span className={`imp-status-badge imp-status-${h.status}`}>
                    <span className="imp-status-dot" />
                    {ROTULOS_STATUS_IMPORTACAO[h.status] || h.status}
                  </span>
                </div>
                <div className="imp-card-meta">{formatarDataHoraCurta(h.created_at)} · {h.nome_usuario}</div>
                <div className="imp-card-row">
                  <span>Origem</span>
                  <span>{ROTULOS_ORIGEM_IMPORTACAO[h.origem] || h.origem}</span>
                </div>
                <div className="imp-card-row">
                  <span>Registros</span>
                  <span>{h.total_registros ?? '—'}</span>
                </div>
              </div>
            ))}
        </div>

        {!erroHistorico && (
          <Pagination pagina={pagina} porPagina={POR_PAGINA} total={total} onMudarPagina={setPagina} />
        )}
      </div>

      <ImportacaoDetalheModal registro={registroSelecionado} onFechar={() => setRegistroSelecionado(null)} />
    </div>
  )
}

function EstadoVazio() {
  return (
    <div className="imp-empty">
      <IconUpload />
      <p>Nenhuma importação realizada ainda.</p>
    </div>
  )
}
