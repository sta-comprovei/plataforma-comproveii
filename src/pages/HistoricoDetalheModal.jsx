import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/ui/Modal'
import OperacaoStatusBadge from '../components/ui/OperacaoStatusBadge'
import { listarAuditoriaDoRegistro, ROTULOS_TIPO_ACAO } from '../lib/auditoriaService'
import { formatarDataBR, formatarLeadTime } from '../lib/dataHoraUtils'
import './Historico.css'

function formatarDataHoraAuditoria(dataHora) {
  return new Date(dataHora).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Modal de visualização completa de uma operação do Histórico:
 * dados do motorista, dados da operação, Lead Time, divergências,
 * observações e auditoria relacionada.
 *
 * A seção de auditoria só é exibida para administradores — a tabela
 * historico_auditoria é restrita por RLS a esse perfil (ver migration
 * 0003), então um operador veria sempre uma lista vazia ali; em vez de
 * mostrar isso de forma confusa, escondemos a seção inteira para quem
 * não tem permissão.
 */
export default function HistoricoDetalheModal({ operacao, onFechar }) {
  const { isAdmin } = useAuth()
  const [auditoria, setAuditoria] = useState([])
  const [carregandoAuditoria, setCarregandoAuditoria] = useState(false)

  useEffect(() => {
    if (!operacao || !isAdmin) {
      setAuditoria([])
      return undefined
    }
    let ativo = true
    setCarregandoAuditoria(true)
    listarAuditoriaDoRegistro('operacoes', operacao.id).then((resultado) => {
      if (!ativo) return
      setCarregandoAuditoria(false)
      if (!resultado.erro) setAuditoria(resultado.dados)
    })
    return () => {
      ativo = false
    }
  }, [operacao, isAdmin])

  if (!operacao) return null

  return (
    <Modal aberto={!!operacao} titulo="Detalhes da Operação" onFechar={onFechar}>
      <div className="hist-detail-section-title">Motorista</div>
      <div className="hist-detail-grid">
        <div className="hist-detail-item">
          <label>Nome</label>
          <span>{operacao.nome_motorista}</span>
        </div>
        <div className="hist-detail-item">
          <label>Código</label>
          <span>{operacao.codigo_motorista}</span>
        </div>
      </div>

      <div className="hist-detail-section-title">Operação</div>
      <div className="hist-detail-grid">
        <div className="hist-detail-item">
          <label>Data</label>
          <span>{formatarDataBR(operacao.data_operacao)}</span>
        </div>
        <div className="hist-detail-item">
          <label>Tipo</label>
          <span>{operacao.tipo_operacao}</span>
        </div>
        <div className="hist-detail-item">
          <label>Rota</label>
          <span>{operacao.rota}</span>
        </div>
        <div className="hist-detail-item">
          <label>Placa</label>
          <span>{operacao.placa || '—'}</span>
        </div>
        <div className="hist-detail-item">
          <label>Previstas</label>
          <span>{operacao.entregas_previstas}</span>
        </div>
        <div className="hist-detail-item">
          <label>Realizadas</label>
          <span>{operacao.entregas_realizadas}</span>
        </div>
        <div className="hist-detail-item">
          <label>% Conclusão</label>
          <span>{operacao.percentual_conclusao}%</span>
        </div>
        <div className="hist-detail-item">
          <label>Status</label>
          <span>
            <OperacaoStatusBadge status={operacao.status} />
          </span>
        </div>
      </div>

      <div className="hist-detail-section-title">Cronologia e Lead Time</div>
      <div className="hist-detail-grid">
        <div className="hist-detail-item">
          <label>Início</label>
          <span>
            {formatarDataBR(operacao.data_inicio)} {operacao.hora_inicio?.slice(0, 5)}
          </span>
        </div>
        <div className="hist-detail-item">
          <label>Finalização</label>
          <span>
            {formatarDataBR(operacao.data_finalizacao)} {operacao.hora_finalizacao?.slice(0, 5)}
          </span>
        </div>
        <div className="hist-detail-item">
          <label>Lead Time</label>
          <span>{formatarLeadTime(operacao.lead_time_min)}</span>
        </div>
      </div>

      {(operacao.divergencia || operacao.observacoes) && (
        <>
          <div className="hist-detail-section-title">Divergências e Observações</div>
          {operacao.divergencia && (
            <div className="hist-detail-item" style={{ marginBottom: 10 }}>
              <label>Divergência</label>
              <div className="hist-detail-observacao" style={{ color: 'var(--red)', background: 'var(--red-bg)' }}>
                {operacao.divergencia}
              </div>
            </div>
          )}
          {operacao.observacoes && (
            <div className="hist-detail-item">
              <label>Observações</label>
              <div className="hist-detail-observacao">{operacao.observacoes}</div>
            </div>
          )}
        </>
      )}

      {isAdmin && (
        <>
          <div className="hist-detail-section-title">Auditoria Relacionada</div>
          {carregandoAuditoria && (
            <p style={{ color: 'var(--text3)', fontSize: 12.5 }}>Carregando histórico de alterações...</p>
          )}
          {!carregandoAuditoria && auditoria.length === 0 && (
            <p style={{ color: 'var(--text3)', fontSize: 12.5 }}>Nenhum registro de auditoria encontrado.</p>
          )}
          {!carregandoAuditoria &&
            auditoria.map((a) => (
              <div className="hist-auditoria-item" key={a.id}>
                <div style={{ flex: 1 }}>
                  <strong>{ROTULOS_TIPO_ACAO[a.tipo_acao] || a.tipo_acao}</strong> por {a.nome_usuario}
                </div>
                <div style={{ color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                  {formatarDataHoraAuditoria(a.data_hora)}
                </div>
              </div>
            ))}
        </>
      )}
    </Modal>
  )
}
