/**
 * evolucaoMotoristasService.js
 *
 * Parser e service para o relatório "Gerencial motoristas" do Comprovei.
 * Colunas reais confirmadas por análise do arquivo driversSynthetic*.xls:
 *
 *   MOTORISTA                  → texto (única chave de identidade — sem CPF/código)
 *   ROTAS                      → "N(P%)"
 *   DOCUMENTOS                 → "N(P%)"
 *   QUALIDADE                  → "P%" (percentual puro)
 *   INÍCIO DENTRO DA CERCA     → "N(P%)"
 *   CHEGADA DENTRO DA CERCA    → "N(P%)"
 *   OCORRÊNCIA APONTADA        → "N(P%)"
 *   INTERVALO COMPATÍVEL       → "N(P%)"
 *   APONTAMENTO NA CERCA       → "N(P%)"
 *
 * Colunas PESO-* são ignoradas (existem no arquivo mas não têm uso no histórico).
 *
 * Formato "N(P%)": quantidade absoluta + percentual relativo.
 * Exemplos reais: "60(100%)", "94(76%)", "1(1%)", "0(0%)".
 * Caracteres especiais no final ($, #, !, ", ') são descartados.
 */

import { supabase } from './supabaseClient'

const TABELA = 'historico_desempenho_motoristas'

// Aliases de colunas tolerando variações de acentuação/capitalização
const MAPA = {
  motorista:     ['MOTORISTA', 'Motorista'],
  rotas:         ['ROTAS', 'Rotas'],
  documentos:    ['DOCUMENTOS', 'Documentos'],
  qualidade:     ['QUALIDADE', 'Qualidade'],
  inicio_cerca:  ['INÍCIO DENTRO DA CERCA', 'INICIO DENTRO DA CERCA', 'Início Dentro da Cerca'],
  chegada_cerca: ['CHEGADA DENTRO DA CERCA', 'Chegada Dentro da Cerca'],
  ocorrencia:    ['OCORRÊNCIA APONTADA', 'OCORRENCIA APONTADA', 'Ocorrência Apontada'],
  intervalo:     ['INTERVALO COMPATÍVEL', 'INTERVALO COMPATIVEL', 'Intervalo Compatível'],
  apontamento:   ['APONTAMENTO NA CERCA', 'Apontamento na Cerca'],
}

// Colunas mínimas para identificar o arquivo — definida em fileParsingUtils.js
// Importada diretamente de lá pelo importacoesService.js

// Prefixos de linhas que são subtotais/empresas/rodapés — descartadas
const PREFIXOS_DESCARTAR = [
  'STO', 'FATURAMENTO', 'COOTRAMA', 'RG LOG', 'QUICK DELIVERY',
  'JEOLOG', 'COOP.', 'CM OLIVEIRA', 'TRANS MELO',
]

function resolveColuna(row, aliases) {
  for (const a of aliases) {
    const v = row[a]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return null
}

/**
 * Parseia "N(P%)" → { qtd: N, pct: P }.
 * Descarta sufixos especiais ($, #, !, "), aceita valores sem percentual.
 */
function parseQtdPct(raw) {
  if (!raw || raw === '-' || raw === '') return { qtd: null, pct: null }
  const s = String(raw).replace(/[$#!"'`<>]+$/, '').trim()
  const m = s.match(/^(\d+)\((\d+)%\)/)
  if (m) return { qtd: parseInt(m[1], 10), pct: parseFloat(m[2]) }
  const n = parseInt(s.replace(/\D/g, ''), 10)
  return { qtd: isNaN(n) ? null : n, pct: null }
}

/**
 * Parseia percentual puro: "97%" → 97.0.
 */
function parsePct(raw) {
  if (!raw) return null
  const s = String(raw).replace(/[%$#!"'`<>!]+/g, '').trim()
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

/**
 * Normaliza nome para chave de agrupamento histórico:
 * lowercase, sem acentos, espaços normalizados, telefone removido.
 */
function normalizarNome(nome) {
  return String(nome || '')
    .replace(/\s*-\s*\d{8,}.*$/, '') // remove telefone embutido
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Tenta extrair YYYY-MM do nome do arquivo.
 * Ex: "driversSynthetic_2026-07-03_17_07_31.xls" → "2026-07"
 */
export function detectarCompetencia(nomeArquivo) {
  const m = String(nomeArquivo || '').match(/(\d{4})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}`
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}

function mensagem(error) {
  const msg = (error?.message || '').toLowerCase()
  if (msg.includes('network') || msg.includes('failed to fetch')) return 'Erro de conexão.'
  if (msg.includes('permission denied') || msg.includes('rls')) return 'Sem permissão para inserir dados. Verifique se a migration 0019 foi executada no Supabase.'
  // Retorna a mensagem real do PostgreSQL/Supabase para diagnóstico
  return error?.message || 'Erro inesperado ao salvar registros de desempenho.'
}

function mapearLinha(row, competencia, dataReferencia, importacaoId) {
  const nomeRaw = resolveColuna(row, MAPA.motorista)
  if (!nomeRaw) return null
  if (PREFIXOS_DESCARTAR.some(p => nomeRaw.toUpperCase().startsWith(p))) return null

  const qualidadePct = parsePct(resolveColuna(row, MAPA.qualidade))
  const rotasP       = parseQtdPct(resolveColuna(row, MAPA.rotas))
  const docsP        = parseQtdPct(resolveColuna(row, MAPA.documentos))

  // Linha sem nenhum dado útil → descartar
  if (qualidadePct === null && rotasP.qtd === null && docsP.qtd === null) return null

  const inicioP     = parseQtdPct(resolveColuna(row, MAPA.inicio_cerca))
  const chegadaP    = parseQtdPct(resolveColuna(row, MAPA.chegada_cerca))
  const ocorrenciaP = parseQtdPct(resolveColuna(row, MAPA.ocorrencia))
  const intervaloP  = parseQtdPct(resolveColuna(row, MAPA.intervalo))
  const apontP      = parseQtdPct(resolveColuna(row, MAPA.apontamento))

  return {
    nome_motorista:    nomeRaw.trim(),
    nome_normalizado:  normalizarNome(nomeRaw),
    competencia,
    data_referencia:   dataReferencia,
    qualidade_pct:     qualidadePct,
    rotas_qtd:         rotasP.qtd,     rotas_pct:         rotasP.pct,
    documentos_qtd:    docsP.qtd,      documentos_pct:    docsP.pct,
    inicio_cerca_qtd:  inicioP.qtd,    inicio_cerca_pct:  inicioP.pct,
    chegada_cerca_qtd: chegadaP.qtd,   chegada_cerca_pct: chegadaP.pct,
    ocorrencia_qtd:    ocorrenciaP.qtd,ocorrencia_pct:    ocorrenciaP.pct,
    intervalo_qtd:     intervaloP.qtd, intervalo_pct:     intervaloP.pct,
    apontamento_qtd:   apontP.qtd,     apontamento_pct:   apontP.pct,
    importacao_id:     importacaoId || null,
  }
}

// ── IMPORTAÇÃO ────────────────────────────────────────────────────────────────

export async function importarDesempenhoMotoristas(linhas, competencia, importacaoId) {
  if (!linhas?.length) return { inseridos: 0, ignorados: 0, erros: ['Arquivo sem linhas.'] }
  if (!/^\d{4}-\d{2}$/.test(competencia))
    return { inseridos: 0, ignorados: 0, erros: [`Competência inválida: "${competencia}".`] }

  const dataReferencia = `${competencia}-01`
  const registros = []
  let ignorados = 0

  for (const linha of linhas) {
    const reg = mapearLinha(linha, competencia, dataReferencia, importacaoId)
    if (!reg) { ignorados++; continue }
    registros.push(reg)
  }

  if (!registros.length)
    return { inseridos: 0, ignorados, erros: ['Nenhum motorista com dados válidos.'] }

  let inseridos = 0
  const erros = []
  for (let i = 0; i < registros.length; i += 200) {
    const { error, count } = await supabase.from(TABELA)
      .insert(registros.slice(i, i + 200), { count: 'exact' })
    if (error) erros.push(mensagem(error))
    else inseridos += count ?? registros.slice(i, i + 200).length
  }

  return { inseridos, ignorados, erros }
}

// ── LEITURA — Evolução individual ────────────────────────────────────────────

export async function listarMotoristasComHistorico() {
  const { data, error } = await supabase.from(TABELA)
    .select('nome_motorista, nome_normalizado').order('nome_motorista')
  if (error) return { dados: [], erro: mensagem(error) }
  const map = new Map()
  for (const r of (data ?? [])) {
    if (!map.has(r.nome_normalizado)) map.set(r.nome_normalizado, r.nome_motorista)
  }
  return {
    dados: [...map.entries()].map(([norm, nome]) => ({ nome_normalizado: norm, nome_motorista: nome })),
    erro: null,
  }
}

export async function buscarEvolucaoMotorista(nomeNormalizado, compIni, compFim) {
  if (!nomeNormalizado) return { dados: [], erro: 'Nome obrigatório.' }
  let q = supabase.from(TABELA).select('*')
    .eq('nome_normalizado', nomeNormalizado)
    .order('competencia', { ascending: true })
    .order('importado_em', { ascending: false })
  if (compIni) q = q.gte('competencia', compIni)
  if (compFim) q = q.lte('competencia', compFim)
  const { data, error } = await q
  if (error) return { dados: [], erro: mensagem(error) }
  // Manter apenas o snapshot mais recente por competência
  const map = new Map()
  for (const r of (data ?? [])) if (!map.has(r.competencia)) map.set(r.competencia, r)
  return { dados: [...map.values()], erro: null }
}

export async function listarCompetencias() {
  const { data, error } = await supabase.from('vw_evolucao_mensal_empresa')
    .select('competencia, data_referencia').order('competencia', { ascending: false })
  if (error) return { dados: [], erro: mensagem(error) }
  return { dados: data ?? [], erro: null }
}

// ── LEITURA — Evolução mensal da empresa ─────────────────────────────────────

export async function buscarEvolucaoMensalDesempenho() {
  const { data, error } = await supabase.from('vw_evolucao_mensal_empresa')
    .select('*').order('competencia', { ascending: true })
  if (error) return { dados: [], erro: mensagem(error) }
  return { dados: data ?? [], erro: null }
}

export async function buscarRankingDesempenho() {
  const { data, error } = await supabase.from('vw_ranking_desempenho').select('*')
  if (error) return { dados: [], erro: mensagem(error) }
  return { dados: data ?? [], erro: null }
}
