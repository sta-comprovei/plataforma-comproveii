import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { podeFazer } from '../lib/permissions'
import { listarPendentes, buscarKpisPendentes, retornarParaOperacao, editarPendencia, finalizarPendente, MOTIVOS_PENDENCIA } from '../lib/operacoesPendentesService'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import Button from '../components/ui/Button'
import Pagination from '../components/ui/Pagination'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { IconAlert, IconAlertCircle, IconSearch, IconArrowLeft, IconEdit, IconCheck } from '../components/ui/Icons'
import './OperacoesPendentes.css'

const POR_PAGINA = 15

function fmtData(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) }
function diasEmPendencia(d) { if (!d) return 0; return Math.floor((Date.now()-new Date(d).getTime())/(1000*60*60*24)) }

export default function OperacoesPendentes() {
  const { usuario, perfil } = useAuth()
  const podeEditar  = podeFazer('editar',  perfil)
  const podeMarcar  = podeFazer('marcarPendente', perfil)
  const podeFinaliz = podeFazer('finalizar', perfil)
  const [busca, setBusca] = useState(''); const [motivo, setMotivo] = useState(''); const [dataInicio, setDataInicio] = useState(''); const [dataFim, setDataFim] = useState(''); const [pagina, setPagina] = useState(1)
  const buscaD = useDebouncedValue(busca, 350)
  const [itens, setItens] = useState([]); const [total, setTotal] = useState(0); const [kpis, setKpis] = useState(null); const [carregando, setCarregando] = useState(true); const [erro, setErro] = useState('')
  const [confirmRetorno, setConfirmRetorno] = useState(null); const [confirmFinalizar, setConfirmFinalizar] = useState(null); const [modalEditar, setModalEditar] = useState(null); const [processando, setProcessando] = useState(false); const [feedback, setFeedback] = useState(null)
  const [editMotivo, setEditMotivo] = useState(''); const [editDesc, setEditDesc] = useState(''); const [editObs, setEditObs] = useState(''); const [erroEdit, setErroEdit] = useState('')

  useEffect(() => { setPagina(1) }, [buscaD, motivo, dataInicio, dataFim])

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    const [r1, r2] = await Promise.all([listarPendentes({ busca:buscaD, motivo, dataInicio, dataFim, pagina, porPagina:POR_PAGINA }), buscarKpisPendentes()])
    setCarregando(false)
    if (r1.erro) { setErro(r1.erro); return }
    setItens(r1.dados); setTotal(r1.total)
    if (!r2.erro) setKpis(r2.dados)
  }, [buscaD, motivo, dataInicio, dataFim, pagina])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (!feedback) return; const t=setTimeout(()=>setFeedback(null),4000); return ()=>clearTimeout(t) }, [feedback])

  async function handleRetornar() {
    if (!confirmRetorno) return; setProcessando(true)
    const { erro:e } = await retornarParaOperacao(confirmRetorno.id)
    setProcessando(false); setConfirmRetorno(null)
    if (e) { setFeedback({tipo:'erro',texto:e}); return }
    setFeedback({tipo:'ok',texto:`"${confirmRetorno.nome_motorista}" retornou para Operação do Dia.`}); carregar()
  }

  async function handleFinalizar() {
    if (!confirmFinalizar) return; setProcessando(true)
    const nomeUsuario = usuario?.nome || usuario?.email || 'Sistema'
    const { erro:e } = await finalizarPendente(confirmFinalizar.id, nomeUsuario)
    setProcessando(false); setConfirmFinalizar(null)
    if (e) { setFeedback({tipo:'erro',texto:e}); return }
    setFeedback({tipo:'ok',texto:`"${confirmFinalizar.nome_motorista}" finalizada e movida para o Histórico.`}); carregar()
  }

  async function handleSalvarEditar() {
    if (!modalEditar) return; if (!editMotivo) { setErroEdit('Selecione um motivo.'); return }
    setProcessando(true)
    const { erro:e } = await editarPendencia({ id:modalEditar.id, motivo:editMotivo, descricao:editMotivo==='Outro'?editDesc:null, observacao:editObs, nomeUsuario:usuario?.nome||usuario?.email||'Sistema' })
    setProcessando(false)
    if (e) { setErroEdit(e); return }
    setModalEditar(null); setFeedback({tipo:'ok',texto:'Pendência atualizada.'}); carregar()
  }

  const kpip = kpis ?? {}

  return (
    <div className="op-page">
      <div className="op-header">
        <div className="op-header-icon"><IconAlert width={22} height={22} /></div>
        <div><h2 className="op-titulo">Operações Pendentes</h2><p className="op-subtitulo">Operações retiradas temporariamente da Operação do Dia.</p></div>
      </div>
      {kpis && (
        <div className="op-kpis">
          <div className="op-kpi-card"><div className="op-kpi-valor">{kpip.total??0}</div><div className="op-kpi-label">Total Pendentes</div></div>
          <div className="op-kpi-card"><div className="op-kpi-valor">{kpip.hoje??0}</div><div className="op-kpi-label">Pendentes hoje</div></div>
          <div className="op-kpi-card op-kpi-alerta"><div className="op-kpi-valor">{kpip.acima_3_dias??0}</div><div className="op-kpi-label">Acima de 3 dias</div></div>
          <div className="op-kpi-card op-kpi-critico"><div className="op-kpi-valor">{kpip.acima_7_dias??0}</div><div className="op-kpi-label">Acima de 7 dias</div></div>
          <div className="op-kpi-card"><div className="op-kpi-valor">{kpip.tempo_medio_horas!=null?`${kpip.tempo_medio_horas}h`:'—'}</div><div className="op-kpi-label">Tempo médio</div></div>
        </div>
      )}
      {feedback && <div className={`op-feedback op-feedback-${feedback.tipo}`}>{feedback.texto}</div>}
      <div className="op-filtros">
        <div className="op-busca-wrap"><IconSearch className="op-busca-icon" /><input className="op-busca-input" placeholder="Motorista ou rota..." value={busca} onChange={e=>setBusca(e.target.value)} /></div>
        <select className="op-select" value={motivo} onChange={e=>setMotivo(e.target.value)}><option value="">Todos os motivos</option>{MOTIVOS_PENDENCIA.map(m=><option key={m} value={m}>{m}</option>)}</select>
        <input className="op-input-data" type="date" value={dataInicio} onChange={e=>setDataInicio(e.target.value)} />
        <span style={{color:'var(--text3)',fontSize:12.5}}>até</span>
        <input className="op-input-data" type="date" value={dataFim} onChange={e=>setDataFim(e.target.value)} />
      </div>
      <div className="op-card">
        <div className="op-table-wrap">
          <table className="op-table">
            <thead><tr><th>Motorista</th><th>Rota</th><th>Data Op.</th><th>Motivo</th><th>Pendente desde</th><th>Dias</th><th style={{textAlign:'right'}}>Ações</th></tr></thead>
            <tbody>
              {carregando && <tr><td colSpan={7} style={{textAlign:'center',color:'var(--text3)',padding:32}}>Carregando...</td></tr>}
              {!carregando && erro && <tr><td colSpan={7}><div style={{display:'flex',gap:8,alignItems:'center',color:'var(--red)',padding:20}}><IconAlertCircle width={14}/>{erro}</div></td></tr>}
              {!carregando && !erro && itens.length===0 && <tr><td colSpan={7} style={{textAlign:'center',color:'var(--text3)',padding:32}}>Nenhuma operação pendente.</td></tr>}
              {!carregando && !erro && itens.map(item=>{
                const dias=diasEmPendencia(item.data_pendencia)
                const cor=dias>=7?'var(--red)':dias>=3?'var(--amber,#b45309)':'var(--text3)'
                return (
                  <tr key={item.id}>
                    <td><div style={{fontWeight:600}}>{item.nome_motorista}</div><div style={{fontSize:12,color:'var(--text3)'}}>{item.codigo_motorista}</div></td>
                    <td>{item.rota||'—'}</td>
                    <td style={{fontSize:12.5}}>{fmtData(item.data_operacao)}</td>
                    <td style={{fontSize:12.5}}>{item.motivo_pendencia==='Outro'&&item.descricao_pendencia?item.descricao_pendencia:item.motivo_pendencia}</td>
                    <td style={{fontSize:12,color:'var(--text3)'}}>{fmtData(item.data_pendencia)}</td>
                    <td><span style={{display:'inline-block',padding:'2px 8px',borderRadius:20,fontSize:11.5,fontWeight:700,color:cor}}>{dias}d</span></td>
                    <td><div style={{display:'flex',gap:4,justifyContent:'flex-end'}}>
                      {podeEditar && <Button variant="ghost" size="sm" icon={IconEdit} onClick={()=>{setModalEditar(item);setEditMotivo(item.motivo_pendencia||MOTIVOS_PENDENCIA[0]);setEditDesc(item.descricao_pendencia||'');setEditObs(item.observacao_pendencia||'');setErroEdit('')}} title="Editar pendência"/>}
                      {podeMarcar && <Button variant="ghost" size="sm" icon={IconArrowLeft} onClick={()=>setConfirmRetorno(item)} style={{color:'var(--green)'}} title="Retornar para Operação do Dia"/>}
                      {podeFinaliz && <Button variant="ghost" size="sm" icon={IconCheck} onClick={()=>setConfirmFinalizar(item)} style={{color:'var(--orange)'}} title="Finalizar operação"/>}
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!erro && <Pagination pagina={pagina} porPagina={POR_PAGINA} total={total} onMudarPagina={setPagina}/>}
      </div>
      <ConfirmDialog aberto={!!confirmFinalizar} titulo="Finalizar Operação" mensagem={confirmFinalizar?`A operação de "${confirmFinalizar.nome_motorista}" será finalizada e movida para o Histórico. Esta ação não pode ser desfeita.`:''} textoConfirmar="Finalizar" variantConfirmar="danger" carregando={processando} onConfirmar={handleFinalizar} onCancelar={()=>setConfirmFinalizar(null)}/>
      <ConfirmDialog aberto={!!confirmRetorno} titulo="Retornar para Operação do Dia" mensagem={confirmRetorno?`A operação de "${confirmRetorno.nome_motorista}" voltará para a Operação do Dia. Deseja continuar?`:''} textoConfirmar="Retornar" variantConfirmar="primary" carregando={processando} onConfirmar={handleRetornar} onCancelar={()=>setConfirmRetorno(null)}/>
      <Modal aberto={!!modalEditar} titulo="Editar Pendência" onFechar={()=>setModalEditar(null)}>
        {modalEditar && (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div><label style={{fontSize:12.5,fontWeight:600,display:'block',marginBottom:4}}>Motivo *</label><select value={editMotivo} onChange={e=>setEditMotivo(e.target.value)} style={{width:'100%',padding:'8px 10px',border:'1.5px solid var(--border)',borderRadius:'var(--radius2)',fontSize:13.5}}>{MOTIVOS_PENDENCIA.map(m=><option key={m} value={m}>{m}</option>)}</select></div>
            {editMotivo==='Outro'&&<div><label style={{fontSize:12.5,fontWeight:600,display:'block',marginBottom:4}}>Descrição *</label><input value={editDesc} onChange={e=>setEditDesc(e.target.value)} placeholder="Descreva o motivo..." style={{width:'100%',padding:'8px 10px',border:'1.5px solid var(--border)',borderRadius:'var(--radius2)',fontSize:13.5}}/></div>}
            <div><label style={{fontSize:12.5,fontWeight:600,display:'block',marginBottom:4}}>Observação</label><textarea value={editObs} onChange={e=>setEditObs(e.target.value)} rows={3} style={{width:'100%',padding:'8px 10px',border:'1.5px solid var(--border)',borderRadius:'var(--radius2)',fontSize:13.5,resize:'vertical'}}/></div>
            {erroEdit&&<div style={{color:'var(--red)',fontSize:13,display:'flex',gap:6,alignItems:'center'}}><IconAlertCircle width={14}/>{erroEdit}</div>}
            <div style={{display:'flex',gap:8}}><Button variant="ghost" onClick={()=>setModalEditar(null)} style={{flex:1}}>Cancelar</Button><Button variant="primary" icon={IconCheck} onClick={handleSalvarEditar} carregando={processando} style={{flex:2}}>Salvar</Button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
