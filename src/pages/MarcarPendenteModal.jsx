import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import { IconAlertCircle } from '../components/ui/Icons'

const MOTIVOS = [
  'Possível Reentrega',
  'Cliente Fechado',
  'Aguardando Cliente',
  'Aguardando Comercial',
  'Problema Operacional',
  'Outro',
]

/**
 * Modal para marcar operação como Pendente.
 * Remove a operação da Operação do Dia sem finalizar.
 *
 * Props:
 *   operacao     — operação alvo (null = fechado)
 *   nomeUsuario  — usuário logado
 *   onSalvo()    — após sucesso
 *   onCancelar() — fechar sem salvar
 */
export default function MarcarPendenteModal({ operacao, nomeUsuario, onSalvo, onCancelar }) {
  const [motivo,     setMotivo]     = useState(MOTIVOS[0])
  const [descricao,  setDescricao]  = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando,   setSalvando]   = useState(false)
  const [erro,       setErro]       = useState('')

  async function handleSalvar() {
    setErro('')
    if (!motivo) { setErro('Selecione um motivo.'); return }
    if (motivo === 'Outro' && !descricao.trim()) { setErro('Descreva o motivo.'); return }

    setSalvando(true)
    try {
      const { error } = await supabase.rpc('fn_marcar_pendente', {
        p_id:         operacao.id,
        p_motivo:     motivo,
        p_descricao:  motivo === 'Outro' ? descricao.trim() : null,
        p_observacao: observacao.trim() || null,
        p_usuario:    nomeUsuario || 'Sistema',
      })
      if (error) {
        setErro(error.message || 'Não foi possível marcar como pendente.')
        return
      }
      fechar()
      onSalvo()
    } catch (e) {
      setErro(e.message || 'Erro inesperado.')
    } finally {
      setSalvando(false)
    }
  }

  function fechar() {
    setMotivo(MOTIVOS[0])
    setDescricao('')
    setObservacao('')
    setErro('')
    onCancelar()
  }

  const input = {
    width: '100%', padding: '8px 10px',
    border: '1.5px solid var(--border)', borderRadius: 'var(--radius2)',
    fontSize: 13.5, color: 'var(--text)', background: 'var(--bg)', outline: 'none',
  }
  const label = { fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }

  return (
    <Modal aberto={!!operacao} titulo="Marcar como Pendente" onFechar={fechar} tamanho="sm">
      {operacao && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, margin: 0 }}>
            A operação de <strong>{operacao.nome_motorista}</strong> será retirada da
            Operação do Dia temporariamente. Ela não será finalizada nem enviada para o Histórico.
          </p>

          <div>
            <label style={label}>Motivo *</label>
            <select value={motivo} onChange={e => { setMotivo(e.target.value); setDescricao('') }}
              style={{ ...input, cursor: 'pointer' }} disabled={salvando}>
              {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {motivo === 'Outro' && (
            <div>
              <label style={label}>Descrição *</label>
              <input type="text" value={descricao} onChange={e => setDescricao(e.target.value)}
                placeholder="Descreva o motivo..." style={input} disabled={salvando} autoFocus />
            </div>
          )}

          <div>
            <label style={label}>Observação <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(opcional)</span></label>
            <textarea value={observacao} onChange={e => setObservacao(e.target.value)}
              placeholder="Detalhes adicionais, próximos passos..."
              rows={3} style={{ ...input, resize: 'vertical' }} disabled={salvando} />
          </div>

          {erro && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--red)', fontSize: 13 }}>
              <IconAlertCircle width={14} height={14} />{erro}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <Button variant="ghost" onClick={fechar} disabled={salvando} style={{ flex: 1 }}>Cancelar</Button>
            <Button variant="primary" onClick={handleSalvar} carregando={salvando} style={{ flex: 2 }}>
              Marcar como Pendente
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
