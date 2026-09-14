import { useEffect, useMemo, useState } from 'react'
import Modal from '../components/ui/Modal'
import LineChart from '../components/ui/LineChart'
import { IconUserCircle, IconClock } from '../components/ui/Icons'
import {
  buscarOperacoesComLeadTime,
  calcularIndicadoresMotorista,
  calcularEvolucaoMensal,
} from '../lib/leadTimeService'
import { TIPOS_OPERACAO } from '../lib/operacoesService'
import { formatarLeadTime, formatarLeadTimeDecimal } from '../lib/dataHoraUtils'
import './LeadTime.css'

const CORES_CATEGORIA = { DF: '#F97316', Adega: '#2563EB', Filial: '#7C3AED' }
const MESES_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function rotuloMes(chaveMes) {
  const [, mes] = chaveMes.split('-')
  return MESES_LABEL[Number(mes) - 1]
}

/**
 * Modal de perfil do motorista — indicadores de Lead Time pedidos pela
 * Etapa 4: médio, maior, menor, quantidade de operações, evolução
 * mensal. Acionado a partir da listagem de Motoristas (Etapa 2).
 */
export default function MotoristaPerfilModal({ motorista, onFechar }) {
  const [operacoes, setOperacoes] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!motorista) return undefined
    let ativo = true
    setCarregando(true)
    setErro('')
    buscarOperacoesComLeadTime({ motoristaId: motorista.id }).then((resultado) => {
      if (!ativo) return
      setCarregando(false)
      if (resultado.erro) {
        setErro(resultado.erro)
        setOperacoes([])
        return
      }
      setOperacoes(resultado.dados)
    })
    return () => {
      ativo = false
    }
  }, [motorista])

  const indicadoresGerais = useMemo(() => calcularIndicadoresMotorista(operacoes), [operacoes])

  const evolucaoMensal = useMemo(() => calcularEvolucaoMensal(operacoes, 6), [operacoes])
  const seriesEvolucao = TIPOS_OPERACAO.map((tipo) => ({
    nome: tipo,
    cor: CORES_CATEGORIA[tipo],
    valores: evolucaoMensal.map((m) => (m[tipo] !== null ? Math.round((m[tipo] / 60) * 100) / 100 : null)),
  }))
  const labelsEvolucao = evolucaoMensal.map((m) => rotuloMes(m.mes))

  if (!motorista) return null

  return (
    <Modal aberto={!!motorista} titulo="Perfil do Motorista" onFechar={onFechar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--orange-light)',
            color: 'var(--orange)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <IconUserCircle width={24} height={24} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{motorista.nome}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Código: {motorista.codigo}</div>
        </div>
      </div>

      {carregando && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando indicadores...</p>}
      {erro && <p style={{ color: 'var(--red)', fontSize: 13 }}>{erro}</p>}

      {!carregando && !erro && (
        <>
          {indicadoresGerais.quantidade === 0 ? (
            <div className="lt-empty">
              <IconClock />
              <p>Este motorista ainda não possui operações finalizadas com Lead Time calculado.</p>
            </div>
          ) : (
            <>
              <div className="lt-mini-stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 18 }}>
                <div className="lt-mini-stat">
                  <label>Operações</label>
                  <span>{indicadoresGerais.quantidade}</span>
                </div>
                <div className="lt-mini-stat">
                  <label>LT Médio</label>
                  <span>{formatarLeadTime(indicadoresGerais.media)}</span>
                </div>
                <div className="lt-mini-stat">
                  <label>Maior</label>
                  <span>{formatarLeadTime(indicadoresGerais.maior)}</span>
                </div>
                <div className="lt-mini-stat">
                  <label>Menor</label>
                  <span>{formatarLeadTime(indicadoresGerais.menor)}</span>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 18 }}>
                Lead Time médio em decimal: {formatarLeadTimeDecimal(indicadoresGerais.media)}
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                Evolução mensal (últimos 6 meses)
              </div>
              <LineChart labels={labelsEvolucao} series={seriesEvolucao} formatarValor={(v) => `${v}h`} altura={180} />
            </>
          )}
        </>
      )}
    </Modal>
  )
}
