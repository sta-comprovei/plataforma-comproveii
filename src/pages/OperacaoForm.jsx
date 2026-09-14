import { useEffect, useState } from 'react'
import {
  criarOperacao,
  atualizarOperacao,
  TIPOS_OPERACAO,
  STATUS_OPERACAO,
} from '../lib/operacoesService'
import { useMotoristaPorCodigo } from '../lib/useMotoristaPorCodigo'
import { calcularPercentual, hojeISO } from '../lib/dataHoraUtils'
import Button from '../components/ui/Button'
import { IconAlertCircle, IconCheck } from '../components/ui/Icons'
import './OperacaoDoDia.css'

const VAZIO = {
  dataOperacao: '',
  codigoMotorista: '',
  tipoOperacao: '',
  rota: '',
  placa: '',
  entregasPrevistas: '',
  entregasRealizadas: '',
  dataInicio: '',
  horaInicio: '',
  dataFinalizacao: '',
  horaFinalizacao: '',
  status: 'Pendente',
  divergencia: '',
  observacoes: '',
}

/**
 * Formulário de criação/edição de operação. Quando `operacao` é fornecida,
 * o formulário entra em modo de edição (código do motorista travado — para
 * trocar o motorista de uma operação já criada, a operação deve ser
 * excluída e recriada, já que o snapshot codigo/nome pertence ao registro
 * original).
 */
export default function OperacaoForm({ operacao, onSalvo, onCancelar }) {
  const editando = !!operacao

  const [valores, setValores] = useState(VAZIO)
  const [erros, setErros] = useState({})
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Busca automática do motorista pelo código digitado (Etapa 2 → Etapa 3)
  const { motorista, carregando: buscandoMotorista, naoEncontrado } = useMotoristaPorCodigo(
    editando ? '' : valores.codigoMotorista
  )

  useEffect(() => {
    if (operacao) {
      setValores({
        dataOperacao: operacao.data_operacao,
        codigoMotorista: operacao.codigo_motorista,
        tipoOperacao: operacao.tipo_operacao,
        rota: operacao.rota,
        placa: operacao.placa || '',
        entregasPrevistas: String(operacao.entregas_previstas),
        entregasRealizadas: String(operacao.entregas_realizadas),
        dataInicio: operacao.data_inicio || '',
        horaInicio: operacao.hora_inicio ? operacao.hora_inicio.slice(0, 5) : '',
        dataFinalizacao: operacao.data_finalizacao || '',
        horaFinalizacao: operacao.hora_finalizacao ? operacao.hora_finalizacao.slice(0, 5) : '',
        status: operacao.status,
        divergencia: operacao.divergencia || '',
        observacoes: operacao.observacoes || '',
      })
    } else {
      setValores({ ...VAZIO, dataOperacao: hojeISO() })
    }
    setErros({})
    setErroGeral('')
  }, [operacao])

  function setCampo(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }))
    setErros((e) => ({ ...e, [campo]: undefined }))
  }

  const percentualPreview = calcularPercentual(valores.entregasPrevistas, valores.entregasRealizadas)

  function validar() {
    const novosErros = {}

    if (!valores.dataOperacao) novosErros.dataOperacao = 'Informe a data da operação.'

    if (!editando) {
      const codigoDigitado = valores.codigoMotorista.trim()
      if (!codigoDigitado) {
        novosErros.codigoMotorista = 'Informe o código do motorista.'
      } else if (buscandoMotorista) {
        novosErros.codigoMotorista = 'Aguarde a busca do motorista terminar.'
      } else if (naoEncontrado) {
        novosErros.codigoMotorista = 'Motorista não cadastrado.'
      } else if (!motorista || motorista.codigo.toLowerCase() !== codigoDigitado.toLowerCase()) {
        // Proteção contra a janela do debounce: garante que o motorista
        // exibido realmente corresponde ao código digitado neste exato
        // instante, e não a um resultado defasado de uma busca anterior.
        novosErros.codigoMotorista = 'Aguarde a confirmação do motorista antes de salvar.'
      } else if (!motorista.ativo) {
        novosErros.codigoMotorista = 'Este motorista está inativo. Não é possível criar uma operação para ele.'
      }
    }

    if (!valores.tipoOperacao) novosErros.tipoOperacao = 'Selecione o tipo de operação.'
    if (!valores.rota.trim()) novosErros.rota = 'Informe a rota.'

    const previstas = Number(valores.entregasPrevistas)
    if (valores.entregasPrevistas === '' || Number.isNaN(previstas) || previstas < 0) {
      novosErros.entregasPrevistas = 'Informe um número válido (0 ou mais).'
    }
    const realizadas = Number(valores.entregasRealizadas)
    if (valores.entregasRealizadas === '' || Number.isNaN(realizadas) || realizadas < 0) {
      novosErros.entregasRealizadas = 'Informe um número válido (0 ou mais).'
    }

    if (!valores.status) novosErros.status = 'Selecione o status.'

    // Se há data/hora de finalização, exige também início (para o lead time fazer sentido)
    const temFim = valores.dataFinalizacao || valores.horaFinalizacao
    if (temFim && (!valores.dataInicio || !valores.horaInicio)) {
      novosErros.dataInicio = 'Informe data e hora de início antes de registrar a finalização.'
    }
    if (valores.dataFinalizacao && !valores.horaFinalizacao) {
      novosErros.horaFinalizacao = 'Informe a hora de finalização.'
    }
    if (valores.horaFinalizacao && !valores.dataFinalizacao) {
      novosErros.dataFinalizacao = 'Informe a data de finalização.'
    }

    setErros(novosErros)
    return Object.keys(novosErros).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErroGeral('')

    if (!validar()) return

    setSalvando(true)

    const payloadComum = {
      dataOperacao: valores.dataOperacao,
      tipoOperacao: valores.tipoOperacao,
      rota: valores.rota,
      placa: valores.placa,
      entregasPrevistas: Number(valores.entregasPrevistas),
      entregasRealizadas: Number(valores.entregasRealizadas),
      dataInicio: valores.dataInicio,
      horaInicio: valores.horaInicio,
      dataFinalizacao: valores.dataFinalizacao,
      horaFinalizacao: valores.horaFinalizacao,
      status: valores.status,
      divergencia: valores.divergencia,
      observacoes: valores.observacoes,
    }

    const resultado = editando
      ? await atualizarOperacao(operacao.id, payloadComum)
      : await criarOperacao({
          ...payloadComum,
          motoristaId: motorista.id,
          codigoMotorista: motorista.codigo,
          nomeMotorista: motorista.nome,
        })

    setSalvando(false)

    if (resultado.erro) {
      setErroGeral(resultado.erro)
      return
    }

    onSalvo(resultado.dados)
  }

  return (
    <form className="op-form" onSubmit={handleSubmit} noValidate>
      <div className="op-form-section-title">Identificação</div>
      <div className="op-form-grid">
        <div className="op-form-field">
          <label htmlFor="op-data">
            Data da operação <span className="req">*</span>
          </label>
          <input
            id="op-data"
            type="date"
            value={valores.dataOperacao}
            onChange={(e) => setCampo('dataOperacao', e.target.value)}
            className={erros.dataOperacao ? 'field-error' : ''}
            disabled={salvando}
          />
          {erros.dataOperacao && <ErroTexto texto={erros.dataOperacao} />}
        </div>

        <div className="op-form-field">
          <label htmlFor="op-codigo">
            Código do motorista <span className="req">*</span>
          </label>
          <input
            id="op-codigo"
            type="text"
            placeholder="Ex: 9184"
            value={valores.codigoMotorista}
            onChange={(e) => setCampo('codigoMotorista', e.target.value)}
            className={erros.codigoMotorista ? 'field-error' : ''}
            disabled={salvando || editando}
            readOnly={editando}
          />
          {erros.codigoMotorista && <ErroTexto texto={erros.codigoMotorista} />}
          {!editando && buscandoMotorista && <span className="op-field-hint">Buscando motorista...</span>}
        </div>

        <div className="op-form-field">
          <label htmlFor="op-nome">Nome do motorista</label>
          <input
            id="op-nome"
            type="text"
            value={editando ? operacao.nome_motorista : motorista?.nome || ''}
            readOnly
            placeholder={editando ? '' : 'Preenchido automaticamente'}
          />
          {!editando && motorista && motorista.ativo && (
            <span className="op-field-hint ok">
              <IconCheck width={12} height={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> Motorista
              encontrado
            </span>
          )}
          {!editando && motorista && !motorista.ativo && (
            <ErroTexto texto="Motorista inativo — não é possível usar este código." />
          )}
        </div>

        <div className="op-form-field">
          <label htmlFor="op-tipo">
            Tipo de operação <span className="req">*</span>
          </label>
          <select
            id="op-tipo"
            value={valores.tipoOperacao}
            onChange={(e) => setCampo('tipoOperacao', e.target.value)}
            className={erros.tipoOperacao ? 'field-error' : ''}
            disabled={salvando}
          >
            <option value="">Selecione...</option>
            {TIPOS_OPERACAO.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {erros.tipoOperacao && <ErroTexto texto={erros.tipoOperacao} />}
        </div>

        <div className="op-form-field">
          <label htmlFor="op-rota">
            Rota <span className="req">*</span>
          </label>
          <input
            id="op-rota"
            type="text"
            placeholder="Ex: DF-01"
            value={valores.rota}
            onChange={(e) => setCampo('rota', e.target.value)}
            className={erros.rota ? 'field-error' : ''}
            disabled={salvando}
          />
          {erros.rota && <ErroTexto texto={erros.rota} />}
        </div>

        <div className="op-form-field">
          <label htmlFor="op-placa">Placa</label>
          <input
            id="op-placa"
            type="text"
            placeholder="ABC1D23"
            value={valores.placa}
            onChange={(e) => setCampo('placa', e.target.value.toUpperCase())}
            disabled={salvando}
          />
        </div>
      </div>

      <div className="op-form-section-title">Entregas</div>
      <div className="op-form-grid">
        <div className="op-form-field">
          <label htmlFor="op-prev">
            Entregas previstas <span className="req">*</span>
          </label>
          <input
            id="op-prev"
            type="number"
            min="0"
            value={valores.entregasPrevistas}
            onChange={(e) => setCampo('entregasPrevistas', e.target.value)}
            className={erros.entregasPrevistas ? 'field-error' : ''}
            disabled={salvando}
          />
          {erros.entregasPrevistas && <ErroTexto texto={erros.entregasPrevistas} />}
        </div>

        <div className="op-form-field">
          <label htmlFor="op-real">
            Entregas realizadas <span className="req">*</span>
          </label>
          <input
            id="op-real"
            type="number"
            min="0"
            value={valores.entregasRealizadas}
            onChange={(e) => setCampo('entregasRealizadas', e.target.value)}
            className={erros.entregasRealizadas ? 'field-error' : ''}
            disabled={salvando}
          />
          {erros.entregasRealizadas && <ErroTexto texto={erros.entregasRealizadas} />}
        </div>
      </div>

      {(valores.entregasPrevistas !== '' || valores.entregasRealizadas !== '') && (
        <div className="op-percentual-preview">
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase' }}>
              % de conclusão
            </div>
            <div className="op-percentual-preview-value">{percentualPreview}%</div>
          </div>
        </div>
      )}

      <div className="op-form-section-title">Cronologia</div>
      <div className="op-form-grid">
        <div className="op-form-field">
          <label htmlFor="op-dt-inicio">Data início</label>
          <input
            id="op-dt-inicio"
            type="date"
            value={valores.dataInicio}
            onChange={(e) => setCampo('dataInicio', e.target.value)}
            className={erros.dataInicio ? 'field-error' : ''}
            disabled={salvando}
          />
          {erros.dataInicio && <ErroTexto texto={erros.dataInicio} />}
        </div>
        <div className="op-form-field">
          <label htmlFor="op-hr-inicio">Hora início</label>
          <input
            id="op-hr-inicio"
            type="time"
            value={valores.horaInicio}
            onChange={(e) => setCampo('horaInicio', e.target.value)}
            disabled={salvando}
          />
        </div>
        <div className="op-form-field">
          <label htmlFor="op-dt-fim">Data finalização</label>
          <input
            id="op-dt-fim"
            type="date"
            value={valores.dataFinalizacao}
            onChange={(e) => setCampo('dataFinalizacao', e.target.value)}
            className={erros.dataFinalizacao ? 'field-error' : ''}
            disabled={salvando}
          />
          {erros.dataFinalizacao && <ErroTexto texto={erros.dataFinalizacao} />}
        </div>
        <div className="op-form-field">
          <label htmlFor="op-hr-fim">Hora finalização</label>
          <input
            id="op-hr-fim"
            type="time"
            value={valores.horaFinalizacao}
            onChange={(e) => setCampo('horaFinalizacao', e.target.value)}
            className={erros.horaFinalizacao ? 'field-error' : ''}
            disabled={salvando}
          />
          {erros.horaFinalizacao && <ErroTexto texto={erros.horaFinalizacao} />}
        </div>
      </div>

      <div className="op-form-section-title">Status e observações</div>
      <div className="op-form-grid">
        <div className="op-form-field">
          <label htmlFor="op-status">
            Status <span className="req">*</span>
          </label>
          <select
            id="op-status"
            value={valores.status}
            onChange={(e) => setCampo('status', e.target.value)}
            className={erros.status ? 'field-error' : ''}
            disabled={salvando}
          >
            {STATUS_OPERACAO.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {erros.status && <ErroTexto texto={erros.status} />}
        </div>

        <div className="op-form-field" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="op-divergencia">Divergência</label>
          <input
            id="op-divergencia"
            type="text"
            placeholder="Descreva se houver alguma divergência..."
            value={valores.divergencia}
            onChange={(e) => setCampo('divergencia', e.target.value)}
            disabled={salvando}
          />
        </div>

        <div className="op-form-field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="op-obs">Observações</label>
          <textarea
            id="op-obs"
            rows={3}
            placeholder="Observações gerais sobre a operação..."
            value={valores.observacoes}
            onChange={(e) => setCampo('observacoes', e.target.value)}
            disabled={salvando}
          />
        </div>
      </div>

      {erroGeral && (
        <div className="op-form-alert">
          <IconAlertCircle width={16} height={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{erroGeral}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <Button variant="ghost" onClick={onCancelar} disabled={salvando} style={{ flex: 1 }} type="button">
          Cancelar
        </Button>
        <Button variant="primary" type="submit" carregando={salvando} style={{ flex: 2 }}>
          {editando ? 'Salvar alterações' : 'Criar operação'}
        </Button>
      </div>
    </form>
  )
}

function ErroTexto({ texto }) {
  return (
    <span className="op-field-error-text">
      <IconAlertCircle width={13} height={13} />
      {texto}
    </span>
  )
}
