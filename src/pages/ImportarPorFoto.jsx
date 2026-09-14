import { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { criarOperacao, TIPOS_OPERACAO } from '../lib/operacoesService'
import { useMotoristaPorCodigo } from '../lib/useMotoristaPorCodigo'
import { hojeISO } from '../lib/dataHoraUtils'
import Button from '../components/ui/Button'
import { IconAlertCircle, IconCheck, IconUpload } from '../components/ui/Icons'

/**
 * Modal de importação via foto/PDF da folha operacional.
 *
 * Fluxo:
 *   1. Usuário anexa imagem (JPG/PNG) ou PDF da folha operacional
 *   2. A imagem é enviada à API Anthropic Vision — extrai apenas
 *      data, código do motorista, nome do motorista e rota
 *   3. Tela de conferência permite editar qualquer campo extraído
 *   4. Confirmação → criarOperacao() exatamente como o formulário manual
 *
 * Campos deliberadamente NÃO extraídos (preenchidos manualmente depois,
 * como já acontece na operação normal):
 *   - Placa, veículo, status, entregas, horários, observações
 *
 * Usa a Edge Function 'assistente-ia' — ANTHROPIC_API_KEY fica nos secrets do Supabase.
 *
 * Props:
 *   onSalvo(operacaoSalva) — chamada após gravação bem-sucedida
 *   onCancelar()           — chamada para fechar o modal
 */
export default function ImportarPorFoto({ onSalvo, onCancelar }) {
  const [etapa, setEtapa] = useState('selecionar') // 'selecionar' | 'processando' | 'conferir' | 'salvando'
  const [arquivo, setArquivo] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [erroOCR, setErroOCR] = useState('')
  const [erroSalvar, setErroSalvar] = useState('')

  // Campos extraídos pelo OCR — editáveis pelo usuário na tela de conferência
  const [data, setData] = useState('')
  const [codigoMotorista, setCodigoMotorista] = useState('')
  const [rota, setRota] = useState('')
  const [tipoOperacao, setTipoOperacao] = useState('')
  const [erros, setErros] = useState({})

  const inputRef = useRef(null)

  // Busca automática do motorista pelo código (mesmo hook de OperacaoForm)
  const { motorista, carregando: buscandoMotorista, naoEncontrado } = useMotoristaPorCodigo(
    etapa === 'conferir' ? codigoMotorista : ''
  )

  // ── Passo 1: selecionar arquivo ─────────────────────────────────────────

  function handleArquivo(file) {
    if (!file) return
    const tipo = file.type
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(tipo)) {
      setErroOCR('Formato inválido. Use JPG, PNG ou PDF.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setErroOCR('Arquivo muito grande (máximo 10 MB).')
      return
    }
    setArquivo(file)
    setErroOCR('')
    if (tipo !== 'application/pdf') {
      setPreviewUrl(URL.createObjectURL(file))
    } else {
      setPreviewUrl(null) // PDF não tem preview inline simples
    }
  }

  // ── Passo 2: chamar Anthropic Vision para OCR ───────────────────────────

  async function processarImagem() {
    if (!arquivo) return
    setEtapa('processando')
    setErroOCR('')

    try {
      // Converter arquivo para base64
      const arrayBuffer = await arquivo.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)

      const mediaType = arquivo.type === 'application/pdf' ? 'application/pdf' : arquivo.type

      // Invocar Edge Function — ANTHROPIC_API_KEY nunca sai do servidor
      const { data: fnData, error: fnError } = await supabase.functions.invoke('assistente-ia', {
        body: {
          model:      'claude-opus-4-5',
          max_tokens: 512,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type:   mediaType === 'application/pdf' ? 'document' : 'image',
                  source: { type: 'base64', media_type: mediaType, data: base64 },
                },
                {
                  type: 'text',
                  text: `Analise esta folha operacional e extraia APENAS os campos abaixo.
Ignore completamente veículo, placa, status, quantidades, horários e qualquer outra informação.

Responda SOMENTE com um JSON válido, sem markdown, sem explicações, exatamente neste formato:
{
  "data": "YYYY-MM-DD",
  "codigo_motorista": "string ou vazio",
  "nome_motorista": "string ou vazio",
  "rota": "string ou vazio"
}

- data: data da operação no formato ISO YYYY-MM-DD. Se não encontrar, use "".
- codigo_motorista: código numérico ou alfanumérico do motorista. Se não encontrar, use "".
- nome_motorista: nome completo do motorista. Se não encontrar, use "".
- rota: identificador da rota (ex: DF-01, SP-12, BRASILIA). Se não encontrar, use "".`,
                },
              ],
            },
          ],
        },
      })
      if (fnError) throw new Error(fnError.message || 'Erro na Edge Function')
      if (fnData?.erro) throw new Error(fnData.erro)

      const texto = fnData?.content?.find((b) => b.type === 'text')?.text || ''

      // Parsear o JSON retornado pela IA
      const limpo = texto.replace(/```json|```/g, '').trim()
      const extraido = JSON.parse(limpo)

      // Preencher os campos extraídos
      setData(extraido.data || hojeISO())
      setCodigoMotorista(extraido.codigo_motorista || '')
      setRota(extraido.rota || '')
      setEtapa('conferir')
    } catch (e) {
      setErroOCR(`Não foi possível processar a imagem: ${e.message}`)
      setEtapa('selecionar')
    }
  }

  // ── Passo 3: validar e salvar ────────────────────────────────────────────

  function validar() {
    const novosErros = {}
    if (!data) novosErros.data = 'Informe a data da operação.'
    if (!codigoMotorista.trim()) {
      novosErros.codigo = 'Informe o código do motorista.'
    } else if (buscandoMotorista) {
      novosErros.codigo = 'Aguarde a busca do motorista...'
    } else if (naoEncontrado) {
      novosErros.codigo = 'Motorista não encontrado no cadastro.'
    } else if (!motorista) {
      novosErros.codigo = 'Aguarde a confirmação do motorista.'
    } else if (!motorista.ativo) {
      novosErros.codigo = 'Motorista inativo — não é possível criar operação.'
    }
    if (!rota.trim()) novosErros.rota = 'Informe a rota.'
    if (!tipoOperacao) novosErros.tipoOperacao = 'Selecione o tipo de operação.'
    setErros(novosErros)
    return Object.keys(novosErros).length === 0
  }

  async function handleSalvar() {
    if (!validar()) return
    setEtapa('salvando')
    setErroSalvar('')

    // Chama exatamente a mesma função de criarOperacao — nenhuma mudança no backend
    const resultado = await criarOperacao({
      dataOperacao: data,
      motoristaId: motorista.id,
      codigoMotorista: motorista.codigo,
      nomeMotorista: motorista.nome,
      tipoOperacao,
      rota: rota.trim(),
      placa: '',              // preenchido manualmente depois, como no fluxo normal
      entregasPrevistas: 0,  // preenchido manualmente depois
      entregasRealizadas: 0, // preenchido manualmente depois
      dataInicio: '',
      horaInicio: '',
      dataFinalizacao: '',
      horaFinalizacao: '',
      status: 'Pendente',
      divergencia: '',
      observacoes: 'Criado via importação de foto.',
    })

    if (resultado.erro) {
      setErroSalvar(resultado.erro)
      setEtapa('conferir')
      return
    }

    onSalvo(resultado.dados)
  }

  // ── Renderização ─────────────────────────────────────────────────────────

  if (etapa === 'selecionar' || etapa === 'processando') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--text2)', margin: 0 }}>
          Envie uma foto ou PDF da folha operacional. A IA identificará automaticamente
          a data, o motorista e a rota. Os demais campos (placa, entregas, horários)
          poderão ser preenchidos normalmente depois.
        </p>

        <div
          style={{
            border: '2px dashed var(--border)',
            borderRadius: 10,
            padding: '28px 16px',
            textAlign: 'center',
            cursor: etapa === 'processando' ? 'default' : 'pointer',
            background: 'var(--bg2)',
            transition: 'border-color 0.15s',
          }}
          onClick={() => etapa !== 'processando' && inputRef.current?.click()}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Prévia da folha"
              style={{ maxHeight: 180, maxWidth: '100%', borderRadius: 6, marginBottom: 10 }}
            />
          ) : (
            <IconUpload style={{ margin: '0 auto 8px', color: 'var(--text3)' }} />
          )}
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            {arquivo ? arquivo.name : 'Clique para selecionar JPG, PNG ou PDF'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text4)', marginTop: 4 }}>Máximo 10 MB</div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => handleArquivo(e.target.files?.[0])}
          />
        </div>

        {erroOCR && (
          <div style={{ display: 'flex', gap: 8, color: 'var(--red)', fontSize: 13, alignItems: 'flex-start' }}>
            <IconAlertCircle width={15} height={15} style={{ flexShrink: 0, marginTop: 1 }} />
            {erroOCR}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={onCancelar} style={{ flex: 1 }} disabled={etapa === 'processando'}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={processarImagem}
            disabled={!arquivo || etapa === 'processando'}
            carregando={etapa === 'processando'}
            style={{ flex: 2 }}
          >
            {etapa === 'processando' ? 'Reconhecendo...' : 'Reconhecer campos'}
          </Button>
        </div>
      </div>
    )
  }

  // Tela de conferência
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--green-bg)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--green)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <IconCheck width={14} height={14} />
        Campos reconhecidos. Revise e corrija se necessário antes de confirmar.
      </div>

      {/* Data */}
      <div className="op-form-field">
        <label>Data da operação <span className="req">*</span></label>
        <input
          type="date"
          value={data}
          onChange={(e) => { setData(e.target.value); setErros((p) => ({ ...p, data: undefined })) }}
          className={erros.data ? 'field-error' : ''}
          disabled={etapa === 'salvando'}
        />
        {erros.data && <ErroCampo texto={erros.data} />}
      </div>

      {/* Código do motorista */}
      <div className="op-form-field">
        <label>Código do motorista <span className="req">*</span></label>
        <input
          type="text"
          value={codigoMotorista}
          onChange={(e) => { setCodigoMotorista(e.target.value); setErros((p) => ({ ...p, codigo: undefined })) }}
          placeholder="Ex: 9184"
          className={erros.codigo ? 'field-error' : ''}
          disabled={etapa === 'salvando'}
        />
        {buscandoMotorista && <span className="op-field-hint">Buscando motorista...</span>}
        {!buscandoMotorista && motorista && motorista.ativo && (
          <span className="op-field-hint ok">
            <IconCheck width={12} height={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {motorista.nome}
          </span>
        )}
        {!buscandoMotorista && motorista && !motorista.ativo && (
          <ErroCampo texto="Motorista inativo." />
        )}
        {!buscandoMotorista && naoEncontrado && (
          <ErroCampo texto="Motorista não cadastrado." />
        )}
        {erros.codigo && <ErroCampo texto={erros.codigo} />}
      </div>

      {/* Rota */}
      <div className="op-form-field">
        <label>Rota <span className="req">*</span></label>
        <input
          type="text"
          value={rota}
          onChange={(e) => { setRota(e.target.value); setErros((p) => ({ ...p, rota: undefined })) }}
          placeholder="Ex: DF-01"
          className={erros.rota ? 'field-error' : ''}
          disabled={etapa === 'salvando'}
        />
        {erros.rota && <ErroCampo texto={erros.rota} />}
      </div>

      {/* Tipo de operação — não extraído por OCR, seleção obrigatória */}
      <div className="op-form-field">
        <label>Tipo de operação <span className="req">*</span></label>
        <select
          value={tipoOperacao}
          onChange={(e) => { setTipoOperacao(e.target.value); setErros((p) => ({ ...p, tipoOperacao: undefined })) }}
          className={erros.tipoOperacao ? 'field-error' : ''}
          disabled={etapa === 'salvando'}
        >
          <option value="">Selecione...</option>
          {TIPOS_OPERACAO.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {erros.tipoOperacao && <ErroCampo texto={erros.tipoOperacao} />}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>
        Placa, entregas previstas, horários e demais campos serão preenchidos manualmente
        depois, como de costume.
      </p>

      {erroSalvar && (
        <div style={{ display: 'flex', gap: 8, color: 'var(--red)', fontSize: 13, alignItems: 'flex-start' }}>
          <IconAlertCircle width={15} height={15} style={{ flexShrink: 0, marginTop: 1 }} />
          {erroSalvar}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="ghost"
          onClick={() => setEtapa('selecionar')}
          disabled={etapa === 'salvando'}
          style={{ flex: 1 }}
        >
          Voltar
        </Button>
        <Button
          variant="primary"
          onClick={handleSalvar}
          carregando={etapa === 'salvando'}
          disabled={etapa === 'salvando'}
          style={{ flex: 2 }}
        >
          Confirmar e criar operação
        </Button>
      </div>
    </div>
  )
}

function ErroCampo({ texto }) {
  return (
    <span className="op-field-error-text">
      <IconAlertCircle width={13} height={13} />
      {texto}
    </span>
  )
}
