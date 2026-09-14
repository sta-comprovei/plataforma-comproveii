import Modal from '../components/ui/Modal'
import { ROTULOS_STATUS_IMPORTACAO, ROTULOS_ORIGEM_IMPORTACAO } from '../lib/importacoesService'
import './Importacoes.css'

function formatarBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatarDataHora(dataHora) {
  return new Date(dataHora).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ImportacaoDetalheModal({ registro, onFechar }) {
  if (!registro) return null

  const erros = Array.isArray(registro.detalhes_erros) ? registro.detalhes_erros : []

  return (
    <Modal aberto={!!registro} titulo="Detalhes da Importação" onFechar={onFechar}>
      <div className="imp-detail-grid">
        <div className="imp-detail-item">
          <label>Arquivo</label>
          <span>{registro.nome_arquivo}</span>
        </div>
        <div className="imp-detail-item">
          <label>Tamanho</label>
          <span>{formatarBytes(registro.tamanho_bytes)}</span>
        </div>
        <div className="imp-detail-item">
          <label>Tipo</label>
          <span>{registro.tipo_arquivo?.toUpperCase()}</span>
        </div>
        <div className="imp-detail-item">
          <label>Origem</label>
          <span>{ROTULOS_ORIGEM_IMPORTACAO[registro.origem] || registro.origem}</span>
        </div>
        <div className="imp-detail-item">
          <label>Status</label>
          <span>{ROTULOS_STATUS_IMPORTACAO[registro.status] || registro.status}</span>
        </div>
        <div className="imp-detail-item">
          <label>Data</label>
          <span>{formatarDataHora(registro.created_at)}</span>
        </div>
        <div className="imp-detail-item">
          <label>Usuário responsável</label>
          <span>{registro.nome_usuario}</span>
        </div>
        <div className="imp-detail-item">
          <label>Total de registros</label>
          <span>{registro.total_registros ?? '—'}</span>
        </div>
        <div className="imp-detail-item">
          <label>Válidos</label>
          <span>{registro.registros_validos ?? '—'}</span>
        </div>
        <div className="imp-detail-item">
          <label>Inválidos</label>
          <span>{registro.registros_invalidos ?? '—'}</span>
        </div>
        <div className="imp-detail-item">
          <label>Duplicados no arquivo</label>
          <span>{registro.registros_duplicados_no_arquivo ?? '—'}</span>
        </div>
      </div>

      {registro.mensagem_resultado && (
        <div className="imp-detail-item" style={{ marginBottom: 14 }}>
          <label>Resultado</label>
          <span style={{ fontWeight: 500 }}>{registro.mensagem_resultado}</span>
        </div>
      )}

      {erros.length > 0 && (
        <>
          <div className="imp-detail-item" style={{ marginBottom: 8 }}>
            <label>Detalhes dos problemas encontrados ({erros.length})</label>
          </div>
          <div className="imp-erros-lista">
            {erros.map((e, i) => (
              <div className="imp-erro-item" key={i}>
                <strong>Linha {e.linha}:</strong>
                {e.mensagem}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
