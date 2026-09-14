import { useEffect, useState } from 'react'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import { IconAlertCircle } from '../components/ui/Icons'
import { formatarCPF, cpfValido, apenasDigitos } from '../lib/cpfUtils'
import { criarMotorista, atualizarMotorista, codigoJaExiste } from '../lib/motoristasService'
import '../components/ui/Modal.css'
import './Motoristas.css'

const VAZIO = { codigo: '', nome: '', cpf: '' }

/**
 * Formulário de cadastro/edição de motorista. Recebe `motorista` (null para
 * criação, objeto para edição) e devolve o registro salvo via `onSalvo`.
 */
export default function MotoristaForm({ aberto, motorista, onFechar, onSalvo }) {
  const editando = !!motorista

  const [valores, setValores] = useState(VAZIO)
  const [erros, setErros] = useState({})
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [verificandoCodigo, setVerificandoCodigo] = useState(false)

  useEffect(() => {
    if (aberto) {
      setValores(
        motorista
          ? { codigo: motorista.codigo, nome: motorista.nome, cpf: formatarCPF(motorista.cpf || '') }
          : VAZIO
      )
      setErros({})
      setErroGeral('')
    }
  }, [aberto, motorista])

  function setCampo(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }))
    setErros((e) => ({ ...e, [campo]: undefined }))
  }

  async function validar() {
    const novosErros = {}

    if (!valores.codigo.trim()) {
      novosErros.codigo = 'O código é obrigatório.'
    }
    if (!valores.nome.trim()) {
      novosErros.nome = 'O nome é obrigatório.'
    }
    if (valores.cpf && !cpfValido(valores.cpf)) {
      novosErros.cpf = 'CPF inválido.'
    }

    if (!novosErros.codigo) {
      setVerificandoCodigo(true)
      const duplicado = await codigoJaExiste(valores.codigo, editando ? motorista.id : null)
      setVerificandoCodigo(false)
      if (duplicado) {
        novosErros.codigo = 'Este código já está em uso por outro motorista.'
      }
    }

    setErros(novosErros)
    return Object.keys(novosErros).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErroGeral('')

    const valido = await validar()
    if (!valido) return

    setSalvando(true)
    const payload = {
      codigo: valores.codigo.trim(),
      nome: valores.nome.trim(),
      cpf: valores.cpf ? apenasDigitos(valores.cpf) : '',
    }

    const resultado = editando
      ? await atualizarMotorista(motorista.id, payload)
      : await criarMotorista(payload)

    setSalvando(false)

    if (resultado.erro) {
      setErroGeral(resultado.erro)
      return
    }

    onSalvo(resultado.dados)
  }

  return (
    <Modal aberto={aberto} titulo={editando ? 'Editar Motorista' : 'Novo Motorista'} onFechar={onFechar}>
      <form className="mot-form" onSubmit={handleSubmit} noValidate>
        <div className="mot-field">
          <label htmlFor="mot-codigo">
            Código <span className="req">*</span>
          </label>
          <input
            id="mot-codigo"
            type="text"
            placeholder="Ex: 9184"
            value={valores.codigo}
            onChange={(e) => setCampo('codigo', e.target.value)}
            className={erros.codigo ? 'field-error' : ''}
            disabled={salvando}
            autoFocus
          />
          {erros.codigo && (
            <span className="mot-field-error-text">
              <IconAlertCircle width={13} height={13} />
              {erros.codigo}
            </span>
          )}
          <span className="mot-field-hint">Identificador único do motorista. Não pode ser duplicado.</span>
        </div>

        <div className="mot-field">
          <label htmlFor="mot-nome">
            Nome <span className="req">*</span>
          </label>
          <input
            id="mot-nome"
            type="text"
            placeholder="Nome completo"
            value={valores.nome}
            onChange={(e) => setCampo('nome', e.target.value)}
            className={erros.nome ? 'field-error' : ''}
            disabled={salvando}
          />
          {erros.nome && (
            <span className="mot-field-error-text">
              <IconAlertCircle width={13} height={13} />
              {erros.nome}
            </span>
          )}
        </div>

        <div className="mot-field">
          <label htmlFor="mot-cpf">CPF (opcional)</label>
          <input
            id="mot-cpf"
            type="text"
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={valores.cpf}
            onChange={(e) => setCampo('cpf', formatarCPF(e.target.value))}
            className={erros.cpf ? 'field-error' : ''}
            disabled={salvando}
            maxLength={14}
          />
          {erros.cpf && (
            <span className="mot-field-error-text">
              <IconAlertCircle width={13} height={13} />
              {erros.cpf}
            </span>
          )}
        </div>

        {erroGeral && (
          <div className="mot-form-alert">
            <IconAlertCircle width={16} height={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{erroGeral}</span>
          </div>
        )}

        <div className="modal-actions">
          <Button variant="ghost" onClick={onFechar} disabled={salvando} style={{ flex: 1 }} type="button">
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            carregando={salvando || verificandoCodigo}
            style={{ flex: 1 }}
          >
            {editando ? 'Salvar alterações' : 'Cadastrar motorista'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
