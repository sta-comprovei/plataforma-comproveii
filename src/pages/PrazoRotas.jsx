import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { podeFazer } from '../lib/permissions'
import {
  buscarPrazosRotas,
  salvarPrazoRota,
  inativarPrazoRota,
  excluirPrazoRota,
  importarPrazosEmMassa,
} from '../lib/funilService'
import { lerEValidarXLSX } from '../lib/fileParsingUtils'
import { exportarExcel } from '../lib/exportUtils'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Button from '../components/ui/Button'
import { IconAlertCircle } from '../components/ui/Icons'
import './PrazoRotas.css'

// ─────────────────────────────────────────────────────────────────────────────
// Formulário de prazo de rota (criar / editar)
// ─────────────────────────────────────────────────────────────────────────────
const PRAZO_VAZIO = { rota: '', codigo_rota: '', uf: '', distancia_km: '', prazo_dias: '', prazo_horas: '', tolerancia_percentual: '20', ativo: true }

function FormPrazo({ prazo, onSalvar, onCancelar, salvando }) {
  const [form, setForm] = useState(prazo ?? PRAZO_VAZIO)

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.rota.trim()) return
    if (!form.prazo_dias || parseInt(form.prazo_dias) <= 0) return
    onSalvar({
      ...form,
      prazo_dias:              form.prazo_dias      ? parseInt(form.prazo_dias)             : null,
      prazo_horas:             form.prazo_horas     ? parseFloat(form.prazo_horas)           : null,
      tolerancia_percentual:   form.tolerancia_percentual ? parseFloat(form.tolerancia_percentual) : 20,
      distancia_km:            form.distancia_km    ? parseFloat(form.distancia_km)          : null,
    })
  }

  return (
    <div className="pr-form-overlay" onClick={e => e.target === e.currentTarget && onCancelar()}>
      <div className="pr-form-modal">
        <div className="pr-form-header">
          <h3>{form.id ? 'Editar Rota' : 'Nova Rota'}</h3>
          <button type="button" className="pr-form-fechar" onClick={onCancelar}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="pr-form-corpo">
          <div className="pr-form-row">
            <div className="pr-form-grupo" style={{ flex: 2 }}>
              <label className="pr-form-label">Rota / Destino *</label>
              <input name="rota" value={form.rota} onChange={handleChange} required
                className="pr-form-input" placeholder="Ex: BRASILIA" />
            </div>
            <div className="pr-form-grupo">
              <label className="pr-form-label">UF</label>
              <input name="uf" value={form.uf} onChange={handleChange} maxLength={2}
                className="pr-form-input" placeholder="DF" style={{ textTransform: 'uppercase' }} />
            </div>
          </div>

          <div className="pr-form-row">
            <div className="pr-form-grupo">
              <label className="pr-form-label">Código da Rota</label>
              <input name="codigo_rota" value={form.codigo_rota} onChange={handleChange}
                className="pr-form-input" placeholder="Código interno" />
            </div>
            <div className="pr-form-grupo">
              <label className="pr-form-label">Distância (km)</label>
              <input name="distancia_km" value={form.distancia_km} onChange={handleChange}
                type="number" min="0" step="0.1" className="pr-form-input" placeholder="Ex: 1250" />
            </div>
            <div className="pr-form-grupo">
              <label className="pr-form-label">Prazo (dias)</label>
              <input name="prazo_dias" value={form.prazo_dias} onChange={handleChange}
                type="number" min="1" className="pr-form-input" placeholder="Ex: 1" />
            </div>
          </div>

          <div className="pr-form-row">
            <div className="pr-form-grupo">
              <label className="pr-form-label">Prazo em horas <span style={{ color: 'var(--orange)', fontWeight: 700 }}>★</span></label>
              <input name="prazo_horas" value={form.prazo_horas} onChange={handleChange}
                type="number" min="0" step="0.5" className="pr-form-input" placeholder="Ex: 48" />
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Tem precedência sobre dias × 24</span>
            </div>
            <div className="pr-form-grupo">
              <label className="pr-form-label">Tolerância (%)</label>
              <input name="tolerancia_percentual" value={form.tolerancia_percentual} onChange={handleChange}
                type="number" min="0" max="100" step="1" className="pr-form-input" placeholder="20" />
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                {form.prazo_horas && form.tolerancia_percentual
                  ? `Limite: ${(parseFloat(form.prazo_horas) * (1 + parseFloat(form.tolerancia_percentual) / 100)).toFixed(1)}h`
                  : 'Limite real = prazo × (1 + tolerância%)'}
              </span>
            </div>
          </div>

          {form.id && (
            <div className="pr-form-grupo pr-form-ativo">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" name="ativo" checked={form.ativo} onChange={handleChange} />
                <span>Rota ativa</span>
              </label>
            </div>
          )}

          <div className="pr-form-acoes">
            <Button variant="ghost" size="sm" type="button" onClick={onCancelar}>Cancelar</Button>
            <Button variant="primary" size="sm" type="submit" carregando={salvando}>
              {form.id ? 'Salvar alterações' : 'Adicionar rota'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
export default function PrazoRotas() {
  const { usuario, perfil } = useAuth()
  const nomeUsuario  = usuario?.nome || usuario?.email || 'Sistema'
  const podeCriar    = podeFazer('configurar', perfil ?? '')
  const podeImportar = podeFazer('importar',   perfil ?? '')
  const podeExportar = podeFazer('exportar',   perfil ?? '')
  const podeExcluir  = podeFazer('excluir',    perfil ?? '')

  const [rotas, setRotas]           = useState([])
  const [apenasAtivos, setApenasAtivos] = useState(true)
  // Após migration 0013: apenasAtivos controla vigente_ate IS NULL (prazos vigentes)
  // Ao desmarcar, exibe o histórico completo de versões de cada rota
  const [busca, setBusca]           = useState('')
  const [formAberto, setFormAberto] = useState(false)
  const [rotaEditando, setRotaEditando] = useState(null)
  const [salvando, setSalvando]     = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]             = useState('')
  const [msgSucesso, setMsgSucesso] = useState('')
  const [confirmExclusao, setConfirmExclusao] = useState(null)
  const [excluindo, setExcluindo]     = useState(false)
  const requisicaoRef               = useRef('')

  // Importação em massa
  const inputImportRef              = useRef(null)
  const [importando, setImportando] = useState(false)
  const [resultImport, setResultImport] = useState(null)

  const carregar = useCallback(async () => {
    const assinatura = `${apenasAtivos}`
    requisicaoRef.current = assinatura
    setCarregando(true)
    setErro('')

    const { dados, erro: e } = await buscarPrazosRotas(apenasAtivos)
    if (requisicaoRef.current !== assinatura) return

    if (e) setErro(e)
    else setRotas(dados ?? [])
    setCarregando(false)
  }, [apenasAtivos])

  useEffect(() => { carregar() }, [carregar])

  async function handleSalvar(prazo) {
    setSalvando(true)
    setErro('')
    const { dados, erro: e } = await salvarPrazoRota(prazo)
    setSalvando(false)
    if (e) { setErro(e); return }

    setMsgSucesso(`Rota "${dados.rota}" salva com sucesso.`)
    setTimeout(() => setMsgSucesso(''), 3000)
    setFormAberto(false)
    setRotaEditando(null)
    carregar()
  }

  async function handleInativar(id, nome) {
    if (!confirm(`Inativar a rota "${nome}"? Ela não será excluída.`)) return
    setErro('')
    const { erro: e } = await inativarPrazoRota(id)
    if (e) { setErro(e); return }
    setMsgSucesso(`Rota "${nome}" inativada.`)
    setTimeout(() => setMsgSucesso(''), 3000)
    carregar()
  }

  async function handleExcluir() {
    if (!confirmExclusao) return
    setExcluindo(true)
    setErro('')
    const { sucesso, erro: e } = await excluirPrazoRota(confirmExclusao.id, nomeUsuario)
    setExcluindo(false)
    setConfirmExclusao(null)
    if (!sucesso) { setErro(e || 'Erro ao excluir.'); return }
    setMsgSucesso(`Rota "${confirmExclusao.rota}" movida para a Lixeira.`)
    setTimeout(() => setMsgSucesso(''), 3000)
    carregar()
  }

  async function handleImportar(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImportando(true)
    setResultImport(null)
    const validacao = await lerEValidarXLSX(file, ['rota', 'prazo_dias'])
    if (!validacao.valido) {
      setResultImport({ erro: validacao.erro || 'Arquivo inválido. Verifique se contém as colunas "rota" e "prazo_dias".' })
      setImportando(false)
      return
    }
    const { inseridos, atualizados, iguais, erros, total } = await importarPrazosEmMassa(validacao.linhas, nomeUsuario)
    setImportando(false)
    setResultImport({ inseridos, atualizados, iguais, erros, total })
    if (inseridos > 0 || atualizados > 0) carregar()
  }

  function handleExportar() {
    if (rotas.length === 0) return
    const COLUNAS = [
      { chave: 'rota',                  rotulo: 'rota' },
      { chave: 'uf',                    rotulo: 'uf' },
      { chave: 'codigo_rota',           rotulo: 'codigo_rota' },
      { chave: 'prazo_dias',            rotulo: 'prazo_dias' },
      { chave: 'prazo_horas',           rotulo: 'prazo_horas' },
      { chave: 'tolerancia_percentual', rotulo: 'tolerancia_percentual' },
      { chave: 'distancia_km',          rotulo: 'distancia_km' },
      { chave: 'ativo',                 rotulo: 'ativo' },
    ]
    const linhasExport = rotas.map(r => ({
      rota:                  r.rota,
      uf:                    r.uf ?? '',
      codigo_rota:           r.codigo_rota ?? '',
      prazo_dias:            r.prazo_dias,
      prazo_horas:           r.prazo_horas ?? '',
      tolerancia_percentual: r.tolerancia_percentual ?? 20,
      distancia_km:          r.distancia_km ?? '',
      ativo:                 r.ativo ? 'Sim' : 'Não',
    }))
    exportarExcel(COLUNAS, linhasExport, 'prazo-rotas', 'Prazo de Rotas')
  }

  function abrirEditar(rota) {
    setRotaEditando(rota)
    setFormAberto(true)
  }

  function fecharForm() {
    setFormAberto(false)
    setRotaEditando(null)
  }

  const rotasFiltradas = rotas.filter(r =>
    !busca || r.rota.toLowerCase().includes(busca.toLowerCase()) ||
    (r.uf && r.uf.toLowerCase().includes(busca.toLowerCase()))
  )

  return (
    <div className="pr-page">

      {/* Cabeçalho */}
      <div className="pr-header">
        <div>
          <h2 className="pr-titulo">Prazo de Rotas</h2>
          <p className="pr-desc">Cadastro de prazos de entrega por destino — base para cálculo de SLA</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {podeExportar && (
            <Button variant="ghost" size="sm" onClick={handleExportar} disabled={rotas.length === 0}>
              ↓ Exportar planilha
            </Button>
          )}
          {podeImportar && (
            <>
              <Button variant="ghost" size="sm"
                onClick={() => inputImportRef.current?.click()}
                carregando={importando} disabled={importando}>
                ↑ Importar planilha
              </Button>
              <input ref={inputImportRef} type="file" accept=".xlsx,.xls"
                style={{ display: 'none' }} onChange={handleImportar} />
            </>
          )}
          {podeCriar && (
            <Button variant="primary" size="sm" onClick={() => setFormAberto(true)}>
              + Adicionar rota
            </Button>
          )}
        </div>
      </div>

      {/* Feedbacks */}
      {erro && (
        <div className="pr-erro">
          <IconAlertCircle width={16} height={16} /> {erro}
        </div>
      )}
      {msgSucesso && (
        <div className="pr-sucesso">{msgSucesso}</div>
      )}
      {resultImport && (
        <div className={resultImport.erro ? 'pr-erro' : 'pr-sucesso'} style={{ whiteSpace: 'pre-line' }}>
          {resultImport.erro
            ? resultImport.erro
            : `Importação concluída: ${resultImport.inseridos} inserida(s) · ${resultImport.atualizados} atualizada(s) · ${resultImport.iguais} sem alteração.${resultImport.erros?.length > 0 ? '\n⚠ ' + resultImport.erros.join('\n⚠ ') : ''}`}
        </div>
      )}

      {/* Controles */}
      <div className="pr-controles">
        <input type="search" placeholder="Buscar rota ou UF…" value={busca}
          onChange={e => setBusca(e.target.value)} className="pr-busca" />
        <label className="pr-toggle-ativos">
          <input type="checkbox" checked={apenasAtivos}
            onChange={e => setApenasAtivos(e.target.checked)} />
          <span>Somente vigentes</span>
        </label>
      </div>

      {/* Tabela */}
      <div className="pr-card">
        {carregando ? (
          <div className="pr-carregando">Carregando rotas…</div>
        ) : rotasFiltradas.length === 0 ? (
          <div className="pr-vazio">
            {busca ? 'Nenhuma rota encontrada para este filtro.' : 'Nenhuma rota cadastrada.'}
          </div>
        ) : (
          <div className="pr-tabela-wrap">
            <table className="pr-tabela">
              <thead>
                <tr>
                  <th>Rota / Destino</th>
                  <th>Código</th>
                  <th>UF</th>
                  <th className="text-right">Prazo</th>
                  <th className="text-right">Prazo (h)</th>
                  <th className="text-right">Tolerância</th>
                  <th className="text-right">Limite real</th>
                  <th>Vigente desde</th>
                  <th>Vigente até</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rotasFiltradas.map(r => (
                  <tr key={r.id} style={{ opacity: r.ativo ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 600 }}>{r.rota}</td>
                    <td className="pr-td-cinza">{r.codigo_rota ?? '—'}</td>
                    <td className="pr-td-cinza">{r.uf ?? '—'}</td>
                    <td className="text-right" style={{ fontWeight: 700, color: 'var(--orange)' }}>
                      {r.prazo_dias ? `${r.prazo_dias}d` : '—'}
                    </td>
                    <td className="text-right" style={{ fontWeight: 600, color: 'var(--blue, #2563eb)' }}>
                      {r.prazo_horas ? `${r.prazo_horas}h` : r.prazo_dias ? `${r.prazo_dias * 24}h` : '—'}
                    </td>
                    <td className="text-right pr-td-cinza">
                      {r.tolerancia_percentual != null ? `${r.tolerancia_percentual}%` : '20%'}
                    </td>
                    <td className="text-right pr-td-cinza">
                      {(() => {
                        const ph = r.prazo_horas ?? (r.prazo_dias ? r.prazo_dias * 24 : null)
                        const tol = r.tolerancia_percentual ?? 20
                        return ph ? `${(ph * (1 + tol / 100)).toFixed(1)}h` : '—'
                      })()}
                    </td>
                    <td className="pr-td-cinza" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {r.vigente_desde
                        ? new Date(r.vigente_desde).toLocaleDateString('pt-BR')
                        : '—'}
                    </td>
                    <td className="pr-td-cinza" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {r.vigente_ate
                        ? <span style={{ color: 'var(--red)' }}>
                            {new Date(r.vigente_ate).toLocaleDateString('pt-BR')}
                          </span>
                        : <span style={{ color: 'var(--green)' }}>Vigente</span>}
                    </td>
                    <td>
                      <span className={`pr-badge${r.ativo ? ' ativo' : ' inativo'}`}>
                        {r.ativo ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {r.vigente_ate === null && (
                          <button type="button" className="pr-btn-acao" onClick={() => abrirEditar(r)}>
                            Editar
                          </button>
                        )}
                        {r.ativo && r.vigente_ate === null && (
                          <button type="button" className="pr-btn-acao pr-btn-inativar"
                            onClick={() => handleInativar(r.id, r.rota)}>
                            Inativar
                          </button>
                        )}
                        {r.vigente_ate !== null && (
                          <span style={{ fontSize: 11, color: 'var(--text4)' }}>histórico</span>
                        )}
                        {r.vigente_ate === null && (
                          <button type="button" className="pr-btn-acao"
                            style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                            onClick={() => setConfirmExclusao(r)}
                            title="Mover para Lixeira">
                            Excluir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pr-rodape">
          {rotasFiltradas.length} rota(s) {apenasAtivos ? 'vigente(s)' : 'no histórico'}
          {' · '}
          <a href="/gargalos" className="pr-link">Ver Gargalos e SLA →</a>
        </div>
      </div>

      {/* Modal de formulário */}
      {formAberto && (
        <FormPrazo
          prazo={rotaEditando}
          onSalvar={handleSalvar}
          onCancelar={fecharForm}
          salvando={salvando}
        />
      )}

      <ConfirmDialog
        aberto={!!confirmExclusao}
        titulo="Mover para a Lixeira"
        mensagem={confirmExclusao ? `A rota "${confirmExclusao.rota}" será movida para a Lixeira. Pode ser restaurada depois.` : ''}
        textoConfirmar="Mover para Lixeira"
        variantConfirmar="danger"
        carregando={excluindo}
        onConfirmar={handleExcluir}
        onCancelar={() => setConfirmExclusao(null)}
      />
    </div>
  )
}
