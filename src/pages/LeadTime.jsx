import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buscarOperacoesComLeadTime,
  calcularIndicadoresPorCategoria,
  calcularEvolucaoMensal,
  calcularEvolucaoMensalRota,
  calcularIntervaloPeriodo,
  buscarMetas,
  calcularIndicadoresPorRota,
  calcularKpisRotas,
} from '../lib/leadTimeService'
import {
  buscarEficienciaRotas,
  calcularKpisEficienciaRotas,
  buscarMapaPrazosPorRota,
  SLA_COR, SLA_BG, SLA_LABEL,
} from '../lib/slaService'
import { listarMotoristasComOperacao, TIPOS_OPERACAO } from '../lib/operacoesService'
import {
  formatarLeadTime,
  formatarLeadTimeDecimal,
} from '../lib/dataHoraUtils'

import LineChart from '../components/ui/LineChart'
import MetaBarChart from '../components/ui/MetaBarChart'
import {
  IconClock,
  IconAlertCircle,
  IconTrendingUp,
  IconTrendingDown,
} from '../components/ui/Icons'

import MetasLeadTimeConfig from './MetasLeadTimeConfig'
import './LeadTime.css'

const CORES_CATEGORIA = { DF: '#F97316', Adega: '#2563EB', Filial: '#7C3AED' }

const MESES_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function rotuloMes(chaveMes) {
  const [, mes] = chaveMes.split('-')
  return MESES_LABEL[Number(mes) - 1]
}

/** Formata o "media" de uma categoria na unidade mais natural (DF/Adega em h, Filial em dias) */
function formatarMediaCategoria(minutos) {
  return formatarLeadTime(minutos)
}

export default function LeadTime() {
  // ---- filtros ----
  const [periodo, setPeriodo] = useState('mes')
  const [dataInicioCustom, setDataInicioCustom] = useState('')
  const [dataFimCustom, setDataFimCustom] = useState('')
  const [motoristaId, setMotoristaId] = useState('')
  const [tipoOperacaoFiltro, setTipoOperacaoFiltro] = useState('')

  // ---- dados ----
  const [operacoes, setOperacoes] = useState([])
  const [metas, setMetas] = useState({})
  const [motoristasDisponiveis, setMotoristasDisponiveis] = useState([])
  const [aba, setAba] = useState('motoristas') // 'motoristas' | 'rotas'
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  // Aba Rotas — dados de eficiência SLA
  const [eficienciaRotas, setEficienciaRotas]   = useState([])
  const [carregandoEfic, setCarregandoEfic]     = useState(false)
  const [rotaSelecionada, setRotaSelecionada]   = useState(null)
  const [rotaFiltro, setRotaFiltro]             = useState('')

  const intervalo = useMemo(() => {
    if (periodo === 'personalizado') {
      return { dataInicio: dataInicioCustom, dataFim: dataFimCustom }
    }
    return calcularIntervaloPeriodo(periodo)
  }, [periodo, dataInicioCustom, dataFimCustom])

  const carregarDados = useCallback(async () => {
    setCarregando(true)
    setErro('')

    // Carregar eficiência por rota em paralelo
    setCarregandoEfic(true)
    Promise.all([buscarEficienciaRotas(), buscarMapaPrazosPorRota()]).then(([resEfic]) => {
      if (!resEfic.erro) setEficienciaRotas(resEfic.dados)
      setCarregandoEfic(false)
    })

    const [resultadoOps, resultadoMetas] = await Promise.all([
      buscarOperacoesComLeadTime({
        dataInicio: intervalo.dataInicio,
        dataFim: intervalo.dataFim,
        motoristaId,
        tipoOperacao: tipoOperacaoFiltro,
      }),
      buscarMetas(),
    ])

    setCarregando(false)

    if (resultadoOps.erro) {
      setErro(resultadoOps.erro)
      setOperacoes([])
      return
    }
    setOperacoes(resultadoOps.dados)

    if (!resultadoMetas.erro) {
      setMetas(resultadoMetas.dados)
    }
  }, [intervalo.dataInicio, intervalo.dataFim, motoristaId, tipoOperacaoFiltro])

  useEffect(() => {
    carregarDados()
  }, [carregarDados])

  useEffect(() => {
    listarMotoristasComOperacao().then((resultado) => {
      if (!resultado.erro) setMotoristasDisponiveis(resultado.dados)
    })
  }, [])

  const metasPorTipoMinutos = useMemo(() => {
    const m = {}
    for (const tipo of TIPOS_OPERACAO) {
      m[tipo] = metas[tipo]?.meta_minutos ?? null
    }
    return m
  }, [metas])

  const indicadores = useMemo(
    () => calcularIndicadoresPorCategoria(operacoes, metasPorTipoMinutos),
    [operacoes, metasPorTipoMinutos]
  )

  // Evolução mensal e Tendência: SEMPRE buscam os últimos 6 meses fixos,
  // independente do filtro de "Período" ativo na tela — esses gráficos
  // são, por definição, uma visão histórica de 6 meses; aplicar o filtro
  // de período a eles (ex.: "Hoje") os deixaria praticamente vazios.
  // Os filtros de Motorista e Tipo de Operação CONTINUAM se aplicando
  // normalmente (ver dependências do useEffect abaixo).
  const [operacoesEvolucao, setOperacoesEvolucao] = useState([])
  useEffect(() => {
    const seisM = new Date()
    seisM.setMonth(seisM.getMonth() - 5)
    seisM.setDate(1)
    const dataInicioEvolucao = `${seisM.getFullYear()}-${String(seisM.getMonth() + 1).padStart(2, '0')}-01`

    buscarOperacoesComLeadTime({
      dataInicio: dataInicioEvolucao,
      motoristaId,
      tipoOperacao: tipoOperacaoFiltro,
    }).then((resultado) => {
      if (!resultado.erro) setOperacoesEvolucao(resultado.dados)
    })
  }, [motoristaId, tipoOperacaoFiltro])

  const evolucaoMensal = useMemo(() => calcularEvolucaoMensal(operacoesEvolucao, 6), [operacoesEvolucao])

  const seriesEvolucao = TIPOS_OPERACAO.map((tipo) => ({
    nome: tipo,
    cor: CORES_CATEGORIA[tipo],
    valores: evolucaoMensal.map((m) => (m[tipo] !== null ? Math.round((m[tipo] / 60) * 100) / 100 : null)),
  }))
  const labelsEvolucao = evolucaoMensal.map((m) => rotuloMes(m.mes))

  // Tendência: compara a média dos últimos 2 meses com a média dos 2
  // meses anteriores a esses, por categoria, para indicar crescimento ou
  // redução do lead time.
  const tendenciaPorCategoria = useMemo(() => {
    const resultado = {}
    for (const tipo of TIPOS_OPERACAO) {
      const valores = evolucaoMensal.map((m) => m[tipo]).filter((v) => v !== null)
      if (valores.length < 2) {
        resultado[tipo] = null
        continue
      }
      const metade = Math.ceil(valores.length / 2)
      const recentes = valores.slice(-metade)
      const anteriores = valores.slice(0, valores.length - metade)
      if (anteriores.length === 0) {
        resultado[tipo] = null
        continue
      }
      const mediaRecente = recentes.reduce((s, v) => s + v, 0) / recentes.length
      const mediaAnterior = anteriores.reduce((s, v) => s + v, 0) / anteriores.length
      const variacao = mediaAnterior > 0 ? ((mediaRecente - mediaAnterior) / mediaAnterior) * 100 : 0
      resultado[tipo] = Math.round(variacao)
    }
    return resultado
  }, [evolucaoMensal])

  // ── Indicadores por rota (aba Rotas) ───────────────────────────────────
  const dadosPorRota   = useMemo(() => calcularIndicadoresPorRota(operacoes), [operacoes])
  const kpisRotas      = useMemo(() => calcularKpisRotas(dadosPorRota), [dadosPorRota])
  const top10Rapidas   = useMemo(() => dadosPorRota.slice(0, 10), [dadosPorRota])
  const top10Lentas    = useMemo(() => [...dadosPorRota].sort((a, b) => (b.media || 0) - (a.media || 0)).slice(0, 10), [dadosPorRota])
  const kpisEfic       = useMemo(() => calcularKpisEficienciaRotas(eficienciaRotas), [eficienciaRotas])
  const top15Atrasadas = useMemo(
    () => [...eficienciaRotas].filter(r => r.situacao === 'vermelho').sort((a, b) => (b.diferenca_min || 0) - (a.diferenca_min || 0)).slice(0, 15),
    [eficienciaRotas]
  )
  const top15Rapidas = useMemo(
    () => [...eficienciaRotas].filter(r => r.prazo_efetivo_min != null).sort((a, b) => (a.eficiencia_pct || 0) - (b.eficiencia_pct || 0)).slice(0, 15),
    [eficienciaRotas]
  )
  const evolucaoRotaSel = useMemo(
    () => rotaSelecionada ? calcularEvolucaoMensalRota(rotaSelecionada.operacoes) : [],
    [rotaSelecionada]
  )

  const dadosMetaBarChart = TIPOS_OPERACAO.map((tipo) => ({
    label: tipo,
    dentro: indicadores[tipo]?.percentualDentroMeta ?? 0,
    fora: indicadores[tipo]?.percentualForaMeta ?? 0,
  })).filter((d) => indicadores[d.label]?.quantidade > 0)

  const temFiltroAtivo = !!(motoristaId || tipoOperacaoFiltro || periodo === 'personalizado')

  return (
    <div>
      <div className="lt-header">
        <div>
          <h2>Lead Time</h2>
          <p>Indicadores de tempo em rota, separados por categoria de operação.</p>
        </div>
      </div>

      {/* Seletor de abas — Motoristas / Rotas */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 16 }}>
        {[['motoristas', 'Motoristas'], ['rotas', 'Rotas']].map(([v, l]) => (
          <button key={v} onClick={() => setAba(v)} style={{
            padding: '8px 20px', fontWeight: aba === v ? 700 : 500, fontSize: 14,
            color: aba === v ? 'var(--orange)' : 'var(--text3)',
            background: 'none', border: 'none',
            borderBottom: `2px solid ${aba === v ? 'var(--orange)' : 'transparent'}`,
            cursor: 'pointer', marginBottom: -2,
          }}>{l}</button>
        ))}
      </div>

      <div className="lt-filters-card">
        <div className="lt-filters-grid">
          <div className="lt-field">
            <label>Período</label>
            <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
              <option value="dia">Hoje</option>
              <option value="semana">Última semana</option>
              <option value="mes">Este mês</option>
              <option value="ano">Este ano</option>
              <option value="personalizado">Personalizado</option>
            </select>
          </div>

          {periodo === 'personalizado' && (
            <>
              <div className="lt-field">
                <label>De</label>
                <input type="date" value={dataInicioCustom} onChange={(e) => setDataInicioCustom(e.target.value)} />
              </div>
              <div className="lt-field">
                <label>Até</label>
                <input type="date" value={dataFimCustom} onChange={(e) => setDataFimCustom(e.target.value)} />
              </div>
            </>
          )}

          <div className="lt-field">
            <label>Motorista</label>
            <select value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)}>
              <option value="">Todos</option>
              {motoristasDisponiveis.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="lt-field">
            <label>Tipo de operação</label>
            <select value={tipoOperacaoFiltro} onChange={(e) => setTipoOperacaoFiltro(e.target.value)}>
              <option value="">Todos</option>
              {TIPOS_OPERACAO.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {erro && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            background: 'var(--red-bg)',
            color: 'var(--red)',
            borderLeft: '3px solid var(--red)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <IconAlertCircle width={15} height={15} />
          {erro}
        </div>
      )}

      {carregando ? (
        <div className="lt-empty">
          <p style={{ color: 'var(--text3)' }}>Carregando indicadores...</p>
        </div>
      ) : operacoes.length === 0 && !erro ? (
        <div className="lt-empty">
          <IconClock />
          <p>
            {temFiltroAtivo
              ? 'Nenhuma operação finalizada encontrada para os filtros selecionados.'
              : 'Nenhuma operação finalizada no período. Os indicadores aparecem aqui assim que operações tiverem Lead Time calculado.'}
          </p>
        </div>
      ) : (
        <>
          {/* ---------- Cards por categoria — NUNCA misturados ---------- */}
          <div className="lt-categorias-grid">
            {TIPOS_OPERACAO.map((tipo) => {
              const ind = indicadores[tipo]
              const semDados = ind.quantidade === 0
              const foraMeta = ind.media !== null && ind.meta !== null && ind.media > ind.meta
              return (
                <div className={`lt-categoria-card cat-${tipo}`} key={tipo}>
                  <div className="lt-categoria-header">
                    <span className="lt-categoria-titulo">{tipo}</span>
                    {ind.meta !== null && (
                      <span className="lt-categoria-meta-chip">Meta: {formatarLeadTime(ind.meta)}</span>
                    )}
                  </div>

                  {semDados ? (
                    <div className="lt-empty-categoria">Nenhuma operação finalizada nesta categoria.</div>
                  ) : (
                    <>
                      <div className={`lt-media-valor${foraMeta ? ' fora-meta' : ''}`}>
                        {formatarMediaCategoria(ind.media)}
                      </div>
                      <div className="lt-media-sub">
                        Lead Time médio · {formatarLeadTimeDecimal(ind.media)} · {ind.quantidade} operações
                      </div>

                      <div className="lt-mini-stats">
                        <div className="lt-mini-stat">
                          <label>Maior</label>
                          <span>{formatarLeadTime(ind.maior)}</span>
                        </div>
                        <div className="lt-mini-stat">
                          <label>Menor</label>
                          <span>{formatarLeadTime(ind.menor)}</span>
                        </div>
                        <div className="lt-mini-stat">
                          <label>Acumulado</label>
                          <span>{formatarLeadTime(ind.totalAcumulado)}</span>
                        </div>
                      </div>

                      {ind.meta !== null && (
                        <div className="lt-meta-progress-row">
                          <div className="lt-meta-progress-bar">
                            <div
                              className="lt-meta-progress-fill"
                              style={{ width: `${ind.percentualDentroMeta}%` }}
                            />
                          </div>
                          <span className="lt-meta-progress-label">{ind.percentualDentroMeta}% na meta</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* ---------- Gráficos ---------- */}
          <div className="lt-charts-grid">
            <div className="lt-chart-card">
              <h3>Evolução mensal (horas)</h3>
              <p className="lt-chart-sub">Lead Time médio por categoria nos últimos 6 meses</p>
              <LineChart
                labels={labelsEvolucao}
                series={seriesEvolucao}
                formatarValor={(v) => `${v}h`}
              />
            </div>

            <div className="lt-chart-card">
              <h3>Cumprimento de metas</h3>
              <p className="lt-chart-sub">% de operações dentro vs. fora da meta, por categoria (período filtrado)</p>
              <MetaBarChart dados={dadosMetaBarChart} />
            </div>

            <div className="lt-chart-card" style={{ gridColumn: '1 / -1' }}>
              <h3>Tendência (últimos 6 meses)</h3>
              <p className="lt-chart-sub">Variação da média recente em relação ao período anterior, por categoria</p>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                {TIPOS_OPERACAO.map((tipo) => {
                  const variacao = tendenciaPorCategoria[tipo]
                  if (variacao === null) {
                    return (
                      <div key={tipo} style={{ fontSize: 12.5, color: 'var(--text3)' }}>
                        <strong>{tipo}:</strong> dados insuficientes
                      </div>
                    )
                  }
                  const subindo = variacao > 0
                  const estavel = variacao === 0
                  return (
                    <div key={tipo} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 13 }}>{tipo}</strong>
                      <span
                        className={`lt-tendencia-badge ${
                          estavel ? 'lt-tendencia-estavel' : subindo ? 'lt-tendencia-subindo' : 'lt-tendencia-descendo'
                        }`}
                      >
                        {!estavel &&
                          (subindo ? (
                            <IconTrendingUp width={12} height={12} />
                          ) : (
                            <IconTrendingDown width={12} height={12} />
                          ))}
                        {estavel ? 'Estável' : `${subindo ? '+' : ''}${variacao}%`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ---------- Tabela por motorista (cumprimento de meta) ---------- */}
          <TabelaPorMotorista operacoes={operacoes} metasPorTipoMinutos={metasPorTipoMinutos} />
        </>
      )}

      {/* ---------- Configuração de metas ---------- */}
      {/* ── Aba Rotas ──────────────────────────────────────────────────────── */}
      {aba === 'rotas' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          {/* KPIs de eficiência */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:10 }}>
            {[
              { label:'Total Rotas',       valor: kpisEfic.totalRotas },
              { label:'Com prazo cadastrado', valor: kpisEfic.comPrazo },
              { label:'Dentro do prazo',   valor: kpisEfic.verde,    cor:'var(--green)' },
              { label:'Na tolerância',     valor: kpisEfic.amarelo,  cor:'var(--amber,#b45309)' },
              { label:'Fora do prazo',     valor: kpisEfic.vermelho, cor:'var(--red)' },
              { label:'Sem prazo',         valor: kpisEfic.semPrazo, cor:'var(--text3)' },
            ].map((k,i) => (
              <div key={i} className="lt-kpi-card">
                <div className="lt-kpi-label">{k.label}</div>
                <div className="lt-kpi-valor" style={k.cor?{color:k.cor}:{}}>{k.valor}</div>
              </div>
            ))}
          </div>

          {/* Tabela comparativa Prazo × Lead Time */}
          {eficienciaRotas.length > 0 && (
            <div className="lt-table-card">
              <h3>Comparativo Prazo × Lead Time Médio</h3>
              <div className="lt-table-wrap">
                <table className="lt-table" style={{ minWidth:700 }}>
                  <thead>
                    <tr>
                      <th>Rota</th>
                      <th style={{textAlign:'right'}}>Prazo</th>
                      <th style={{textAlign:'right'}}>LT Médio</th>
                      <th style={{textAlign:'right'}}>Diferença</th>
                      <th style={{textAlign:'right'}}>Eficiência</th>
                      <th>Status</th>
                      <th style={{textAlign:'center'}}>Fonte</th>
                      <th style={{textAlign:'center'}}>Viagens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eficienciaRotas.map(r => {
                      const sitCor = SLA_COR[r.situacao]??'var(--text3)'
                      const sitBg  = SLA_BG[r.situacao]??'var(--bg3)'
                      const sitLbl = SLA_LABEL[r.situacao]??'—'
                      const ltH    = r.media_min!=null?Math.round(r.media_min/60*10)/10:null
                      const prazoH = r.prazo_efetivo_min!=null?Math.round(r.prazo_efetivo_min/60*10)/10:null
                      const difH   = r.diferenca_min!=null?Math.round(r.diferenca_min/60*10)/10:null
                      return (
                        <tr key={r.rota} style={{cursor:'pointer'}}
                          onClick={() => { const rl=dadosPorRota.find(d=>d.rota===r.rota); if(rl)setRotaSelecionada(rl) }}>
                          <td style={{fontWeight:600}}>{r.rota}</td>
                          <td style={{textAlign:'right',color:'var(--text2)'}}>{prazoH!=null?`${prazoH}h`:'—'}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>{ltH!=null?`${ltH}h`:'—'}</td>
                          <td style={{textAlign:'right',fontWeight:600,color:difH!=null&&difH>0?'var(--red)':'var(--green)'}}>{difH!=null?`${difH>0?'+':''}${difH}h`:'—'}</td>
                          <td style={{textAlign:'right',fontWeight:700,color:r.eficiencia_pct!=null&&r.eficiencia_pct>100?'var(--red)':'var(--green)'}}>{r.eficiencia_pct!=null?`${r.eficiencia_pct}%`:'—'}</td>
                          <td><span style={{display:'inline-block',padding:'2px 8px',borderRadius:20,fontSize:11.5,fontWeight:700,color:sitCor,background:sitBg}}>{sitLbl}</span></td>
                          <td style={{textAlign:'center',fontSize:11.5,color:'var(--text3)'}}>{r.fonte_prazo==='rota'?'Rota':r.fonte_prazo==='categoria'?'Categoria':'—'}</td>
                          <td style={{textAlign:'center'}}>{r.total_viagens}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top 15 mais atrasadas */}
          {top15Atrasadas.length > 0 && (
            <div className="lt-table-card">
              <h3 style={{color:'var(--red)'}}>Top 15 Rotas Mais Atrasadas</h3>
              <div className="lt-table-wrap">
                <table className="lt-table">
                  <thead><tr><th>#</th><th>Rota</th><th>Prazo</th><th>LT Médio</th><th>Excede em</th></tr></thead>
                  <tbody>
                    {top15Atrasadas.map((r,i) => {
                      const prazoH=r.prazo_efetivo_min!=null?Math.round(r.prazo_efetivo_min/60*10)/10:null
                      const ltH=r.media_min!=null?Math.round(r.media_min/60*10)/10:null
                      const difH=r.diferenca_min!=null?Math.round(r.diferenca_min/60*10)/10:null
                      return (<tr key={r.rota}><td style={{color:'var(--text3)',fontSize:12}}>{i+1}</td><td style={{fontWeight:600}}>{r.rota}</td><td style={{color:'var(--text2)'}}>{prazoH!=null?`${prazoH}h`:'—'}</td><td style={{color:'var(--red)',fontWeight:700}}>{ltH!=null?`${ltH}h`:'—'}</td><td style={{color:'var(--red)',fontWeight:700}}>{difH!=null?`+${difH}h`:'—'}</td></tr>)
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top 15 mais rápidas */}
          {top15Rapidas.length > 0 && (
            <div className="lt-table-card">
              <h3 style={{color:'var(--green)'}}>Top 15 Rotas com Melhor Desempenho</h3>
              <div className="lt-table-wrap">
                <table className="lt-table">
                  <thead><tr><th>#</th><th>Rota</th><th>Prazo</th><th>LT Médio</th><th>Eficiência</th></tr></thead>
                  <tbody>
                    {top15Rapidas.map((r,i) => {
                      const prazoH=r.prazo_efetivo_min!=null?Math.round(r.prazo_efetivo_min/60*10)/10:null
                      const ltH=r.media_min!=null?Math.round(r.media_min/60*10)/10:null
                      return (<tr key={r.rota}><td style={{color:'var(--text3)',fontSize:12}}>{i+1}</td><td style={{fontWeight:600}}>{r.rota}</td><td style={{color:'var(--text2)'}}>{prazoH!=null?`${prazoH}h`:'—'}</td><td style={{color:'var(--green)',fontWeight:700}}>{ltH!=null?`${ltH}h`:'—'}</td><td style={{color:'var(--green)',fontWeight:700}}>{r.eficiencia_pct!=null?`${r.eficiencia_pct}%`:'—'}</td></tr>)
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Detalhe da rota selecionada */}
          {rotaSelecionada && (
            <div className="lt-table-card">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <h3>Detalhe: {rotaSelecionada.rota}</h3>
                <button onClick={() => setRotaSelecionada(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text3)',fontSize:20}}>✕</button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:16}}>
                {[
                  { label:'Viagens',     valor:rotaSelecionada.viagens },
                  { label:'LT Médio',    valor:rotaSelecionada.media!=null?formatarLeadTime(rotaSelecionada.media):'—' },
                  { label:'Melhor',      valor:rotaSelecionada.minimo!=null?formatarLeadTime(rotaSelecionada.minimo):'—' },
                  { label:'Pior',        valor:rotaSelecionada.maximo!=null?formatarLeadTime(rotaSelecionada.maximo):'—' },
                ].map((k,i) => (
                  <div key={i} className="lt-kpi-card"><div className="lt-kpi-label">{k.label}</div><div className="lt-kpi-valor">{k.valor}</div></div>
                ))}
              </div>
              {evolucaoRotaSel.length > 1 && (
                <LineChart
                  labels={evolucaoRotaSel.map(e => e.mes.slice(5))}
                  series={[{ nome:'Lead Time (min)', cor:'#F97316', valores:evolucaoRotaSel.map(e => e.media) }]}
                  formatarValor={(v) => formatarLeadTime(v)}
                  altura={180}
                />
              )}
            </div>
          )}

          {eficienciaRotas.length === 0 && !carregandoEfic && (
            <div className="lt-empty"><p>Nenhum dado de rota disponível. Verifique se existem prazos cadastrados e operações finalizadas.</p></div>
          )}
        </div>
      )}

      <MetasLeadTimeConfig metas={metas} onMetasAtualizadas={carregarDados} />
    </div>
  )
}

function TabelaPorMotorista({ operacoes, metasPorTipoMinutos }) {
  const porMotorista = useMemo(() => {
    const grupos = new Map()
    for (const op of operacoes) {
      if (!grupos.has(op.motorista_id)) {
        grupos.set(op.motorista_id, { nome: op.nome_motorista, codigo: op.codigo_motorista, operacoes: [] })
      }
      grupos.get(op.motorista_id).operacoes.push(op)
    }

    return Array.from(grupos.values())
      .map((g) => {
        const valores = g.operacoes.map((o) => o.lead_time_min)
        const media = Math.round(valores.reduce((s, v) => s + v, 0) / valores.length)
        const dentroMeta = g.operacoes.filter((o) => {
          const meta = metasPorTipoMinutos[o.tipo_operacao]
          return meta && o.lead_time_min <= meta
        }).length
        const percentualDentro = Math.round((dentroMeta / g.operacoes.length) * 100)
        return {
          nome: g.nome,
          codigo: g.codigo,
          quantidade: g.operacoes.length,
          media,
          maior: Math.max(...valores),
          menor: Math.min(...valores),
          percentualDentro,
        }
      })
      .sort((a, b) => b.media - a.media)
  }, [operacoes, metasPorTipoMinutos])

  if (porMotorista.length === 0) return null

  return (
    <div className="lt-table-card">
      <div className="lt-table-wrap">
        <table className="lt-table">
          <thead>
            <tr>
              <th>Motorista</th>
              <th style={{ textAlign: 'center' }}>Ops.</th>
              <th style={{ textAlign: 'center' }}>LT Médio</th>
              <th style={{ textAlign: 'center' }}>Maior</th>
              <th style={{ textAlign: 'center' }}>Menor</th>
              <th>% na meta</th>
            </tr>
          </thead>
          <tbody>
            {porMotorista.map((m) => (
              <tr key={m.codigo} className={m.percentualDentro < 50 ? 'fora-meta' : ''}>
                <td>
                  <div style={{ fontWeight: 600 }}>{m.nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{m.codigo}</div>
                </td>
                <td style={{ textAlign: 'center' }}>{m.quantidade}</td>
                <td style={{ textAlign: 'center', fontWeight: 700 }}>{formatarLeadTime(m.media)}</td>
                <td style={{ textAlign: 'center' }}>{formatarLeadTime(m.maior)}</td>
                <td style={{ textAlign: 'center' }}>{formatarLeadTime(m.menor)}</td>
                <td style={{ fontWeight: 700, color: m.percentualDentro >= 50 ? 'var(--green)' : 'var(--red)' }}>
                  {m.percentualDentro}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
