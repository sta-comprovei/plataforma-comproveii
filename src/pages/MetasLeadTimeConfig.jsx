import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { atualizarMeta } from '../lib/leadTimeService'
import { TIPOS_OPERACAO } from '../lib/operacoesService'
import { decomporLeadTime } from '../lib/dataHoraUtils'
import Button from '../components/ui/Button'
import { IconTarget, IconAlertCircle } from '../components/ui/Icons'
import './LeadTime.css'

const ROTULO_UNIDADE = { DF: 'horas', Adega: 'horas', Filial: 'dias' }

/** Converte minutos -> valor de exibição na unidade da categoria (horas ou dias) */
function minutosParaUnidade(minutos, tipo) {
  if (minutos === null || minutos === undefined) return ''
  return tipo === 'Filial' ? Math.round((minutos / 1440) * 10) / 10 : Math.round((minutos / 60) * 10) / 10
}

/** Converte valor digitado na unidade da categoria -> minutos (para salvar) */
function unidadeParaMinutos(valor, tipo) {
  const n = Number(valor)
  if (Number.isNaN(n) || n <= 0) return null
  return tipo === 'Filial' ? Math.round(n * 1440) : Math.round(n * 60)
}

export default function MetasLeadTimeConfig({ metas, onMetasAtualizadas }) {
  const { isAdmin } = useAuth()
  const [valores, setValores] = useState(() => {
    const v = {}
    for (const tipo of TIPOS_OPERACAO) {
      v[tipo] = metas[tipo] ? String(minutosParaUnidade(metas[tipo].meta_minutos, tipo)) : ''
    }
    return v
  })
  const [salvando, setSalvando] = useState('')
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')

  async function salvarMeta(tipo) {
    setErro('')
    setSucesso('')
    const minutos = unidadeParaMinutos(valores[tipo], tipo)
    if (!minutos) {
      setErro(`Informe uma meta válida (maior que zero) para ${tipo}.`)
      return
    }
    setSalvando(tipo)
    const resultado = await atualizarMeta(tipo, minutos)
    setSalvando('')

    if (resultado.erro) {
      setErro(resultado.erro)
      return
    }
    setSucesso(`Meta de ${tipo} atualizada para ${valores[tipo]} ${ROTULO_UNIDADE[tipo]}.`)
    onMetasAtualizadas?.()
  }

  return (
    <div className="lt-metas-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconTarget width={18} height={18} style={{ color: 'var(--orange)' }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Metas de Lead Time</div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>
            {isAdmin
              ? 'Defina a meta independente para cada categoria. Operações acima da meta são destacadas e geram pendência.'
              : 'Apenas administradores podem alterar as metas.'}
          </div>
        </div>
      </div>

      <div className="lt-metas-grid">
        {TIPOS_OPERACAO.map((tipo) => {
          const decomposto = metas[tipo] ? decomporLeadTime(metas[tipo].meta_minutos) : null
          return (
            <div className="lt-meta-field" key={tipo}>
              <label>{tipo}</label>
              <div className="lt-meta-input-row">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={valores[tipo]}
                  onChange={(e) => setValores((v) => ({ ...v, [tipo]: e.target.value }))}
                  disabled={!isAdmin || salvando === tipo}
                />
                <span className="lt-meta-unidade">{ROTULO_UNIDADE[tipo]}</span>
                {isAdmin && (
                  <Button
                    variant="secondary"
                    size="sm"
                    carregando={salvando === tipo}
                    onClick={() => salvarMeta(tipo)}
                  >
                    Salvar
                  </Button>
                )}
              </div>
              {decomposto && (
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>
                  Atual: {tipo === 'Filial' ? `${decomposto.dias} dias` : `${metas[tipo].meta_minutos / 60}h`}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {erro && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--red)', fontSize: 12.5 }}>
          <IconAlertCircle width={14} height={14} style={{ flexShrink: 0, marginTop: 1 }} />
          {erro}
        </div>
      )}
      {sucesso && (
        <div style={{ marginTop: 12, color: 'var(--green)', fontSize: 12.5, fontWeight: 600 }}>{sucesso}</div>
      )}
    </div>
  )
}
