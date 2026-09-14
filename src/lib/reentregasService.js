import { supabase } from './supabaseClient'
import { moverParaLixeira } from './lixeiraService'

/**
 * Camada de acesso a dados do módulo Reentregas — notas fiscais que o SAC
 * realinha com outro motorista.
 *
 * Cada nota é uma linha em `reentregas_notas`. `criarReentregas` aceita uma
 * lista de notas e cria uma linha para cada uma, todas com o mesmo
 * motorista/observação/print — cobre o caso comum de o SAC repassar várias
 * notas de uma vez para o mesmo motorista.
 */

const TABELA = 'reentregas_notas'
const BUCKET = 'reentregas-prints'

export const STATUS_AGUARDANDO = 'AGUARDANDO_MOTORISTA'
export const STATUS_REGISTRADA = 'REGISTRADA'

const COLUNAS = 'id, nota_fiscal, motorista_anterior, motorista_atual, status, observacao, print_path, print_nome_arquivo, data_alinhamento, usuario_criacao, usuario_ultima_alteracao, created_at, updated_at'

function escaparCuringasILike(valor) {
  return valor.replace(/[%_]/g, (c) => `\\${c}`)
}

function mensagem(error) {
  if (!error) return 'Erro desconhecido.'
  const msg = (error.message || '').toLowerCase()
  if (msg.includes('network') || msg.includes('fetch')) return 'Erro de conexão.'
  if (msg.includes('reentregas_status_motorista_ck')) return 'Informe o motorista atual para registrar a reentrega.'
  if (msg.includes('row-level security')) return 'Você não tem permissão para esta ação.'
  return error.message || 'Não foi possível concluir a operação.'
}

/**
 * Separa um texto colado em uma ou várias notas fiscais (vírgula, espaço,
 * ponto e vírgula ou quebra de linha), remove duplicadas e vazias.
 */
export function parseNotasFiscais(texto) {
  const vistas = new Set()
  const resultado = []
  for (const parte of (texto || '').split(/[\s,;]+/)) {
    const nota = parte.trim()
    if (nota && !vistas.has(nota)) {
      vistas.add(nota)
      resultado.push(nota)
    }
  }
  return resultado
}

// ── LISTAR ──────────────────────────────────────────────────────────────────

export async function listarReentregas({ status, busca = '', pagina = 1, porPagina = 15 } = {}) {
  let q = supabase.from(TABELA).select(COLUNAS, { count: 'exact' }).eq('status', status)

  const termo = busca.trim()
  if (termo) {
    q = q.ilike('nota_fiscal', `%${escaparCuringasILike(termo)}%`)
  }

  q = q.order(status === STATUS_REGISTRADA ? 'data_alinhamento' : 'created_at', { ascending: false })

  const from = (pagina - 1) * porPagina
  q = q.range(from, from + porPagina - 1)

  const { data, error, count } = await q
  if (error) return { dados: [], total: 0, erro: mensagem(error) }
  return { dados: data ?? [], total: count ?? 0, erro: null }
}

/**
 * Contagem rápida (sem trazer linhas) para os badges das duas abas.
 */
export async function contarReentregas() {
  const [aguardando, registradas] = await Promise.all([
    supabase.from(TABELA).select('id', { count: 'exact', head: true }).eq('status', STATUS_AGUARDANDO),
    supabase.from(TABELA).select('id', { count: 'exact', head: true }).eq('status', STATUS_REGISTRADA),
  ])
  if (aguardando.error || registradas.error) {
    return { aguardando: 0, registradas: 0, erro: mensagem(aguardando.error || registradas.error) }
  }
  return { aguardando: aguardando.count ?? 0, registradas: registradas.count ?? 0, erro: null }
}

// ── CRIAR (em lote — uma linha por nota) ─────────────────────────────────────

export async function criarReentregas({
  notas,
  motoristaAnterior,
  motoristaAtual,
  observacao,
  printPath,
  printNomeArquivo,
  nomeUsuario,
}) {
  const listaNotas = Array.isArray(notas) ? notas : parseNotasFiscais(notas)
  if (listaNotas.length === 0) return { dados: [], erro: 'Informe ao menos uma nota fiscal.' }
  if (!motoristaAnterior?.trim()) return { dados: [], erro: 'Informe o motorista anterior.' }

  const status = motoristaAtual?.trim() ? STATUS_REGISTRADA : STATUS_AGUARDANDO
  if (status === STATUS_REGISTRADA && !motoristaAtual?.trim()) {
    return { dados: [], erro: 'Informe o motorista atual.' }
  }

  const linhas = listaNotas.map((nota) => ({
    nota_fiscal: nota,
    motorista_anterior: motoristaAnterior.trim(),
    motorista_atual: motoristaAtual?.trim() || null,
    status,
    observacao: observacao?.trim() || null,
    print_path: printPath || null,
    print_nome_arquivo: printPath ? (printNomeArquivo || null) : null,
    usuario_criacao: nomeUsuario || 'Sistema',
  }))

  const { data, error } = await supabase.from(TABELA).insert(linhas).select(COLUNAS)
  if (error) return { dados: [], erro: mensagem(error) }
  return { dados: data ?? [], erro: null }
}

// ── EDITAR (edição livre, mantém a aba atual) ────────────────────────────────

export async function editarReentrega({ id, motoristaAnterior, motoristaAtual, observacao, printPath, printNomeArquivo, removerPrint, nomeUsuario }) {
  if (!id) return { erro: 'ID obrigatório.' }
  if (!motoristaAnterior?.trim()) return { erro: 'Informe o motorista anterior.' }

  const patch = {
    motorista_anterior: motoristaAnterior.trim(),
    observacao: observacao?.trim() || null,
    usuario_ultima_alteracao: nomeUsuario || 'Sistema',
  }
  if (printPath !== undefined) {
    patch.print_path = printPath || null
    patch.print_nome_arquivo = printPath ? (printNomeArquivo || null) : null
  } else if (removerPrint) {
    patch.print_path = null
    patch.print_nome_arquivo = null
  }
  if (motoristaAtual !== undefined) {
    patch.motorista_atual = motoristaAtual?.trim() || null
    patch.status = motoristaAtual?.trim() ? STATUS_REGISTRADA : STATUS_AGUARDANDO
  }

  const { error } = await supabase.from(TABELA).update(patch).eq('id', id)
  if (error) return { erro: mensagem(error) }
  return { erro: null }
}

/**
 * Atribui o motorista atual a uma nota que estava "Aguardando motorista" —
 * ela passa a aparecer em "Reentregas registradas".
 */
export async function atribuirMotorista({ id, motoristaAnterior, motoristaAtual, observacao, printPath, printNomeArquivo, nomeUsuario }) {
  if (!id) return { erro: 'ID obrigatório.' }
  if (!motoristaAtual?.trim()) return { erro: 'Informe o motorista atual.' }
  return editarReentrega({ id, motoristaAnterior, motoristaAtual, observacao, printPath, printNomeArquivo, nomeUsuario })
}

// ── EXCLUIR (via lixeira, como o resto da plataforma) ───────────────────────

export async function excluirReentrega(id, nomeUsuario) {
  const { data: snapshot, error: errSnap } = await supabase.from(TABELA).select('*').eq('id', id).single()
  if (errSnap) return { erro: mensagem(errSnap) }

  const descricao = `Reentrega — Nota ${snapshot.nota_fiscal} (${snapshot.motorista_anterior}${snapshot.motorista_atual ? ` → ${snapshot.motorista_atual}` : ''})`
  const { erro: errLix } = await moverParaLixeira('reentregas_notas', id, descricao, snapshot, nomeUsuario)
  if (errLix) return { erro: errLix }

  const { error } = await supabase.from(TABELA).delete().eq('id', id)
  if (error) return { erro: mensagem(error) }

  if (snapshot.print_path) {
    // Melhor esforço — não bloqueia a exclusão se a limpeza do arquivo falhar.
    supabase.storage.from(BUCKET).remove([snapshot.print_path]).catch(() => {})
  }
  return { erro: null }
}

// ── PRINT DA CONVERSA (opcional em qualquer fluxo) ──────────────────────────

const TIPOS_IMAGEM_ACEITOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const TAMANHO_MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function uploadPrint(file) {
  if (!file) return { path: null, erro: null }
  if (!TIPOS_IMAGEM_ACEITOS.includes(file.type)) {
    return { path: null, erro: 'Envie uma imagem (PNG, JPG, WEBP ou GIF).' }
  }
  if (file.size > TAMANHO_MAX_BYTES) {
    return { path: null, erro: 'Imagem muito grande (máximo 10 MB).' }
  }

  const extensao = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
  const nomeArquivo = `${crypto.randomUUID()}.${extensao}`
  const caminho = `${new Date().toISOString().slice(0, 7)}/${nomeArquivo}`

  const { error } = await supabase.storage.from(BUCKET).upload(caminho, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) return { path: null, erro: mensagem(error) }
  return { path: caminho, erro: null }
}

/**
 * Gera uma URL assinada temporária para exibir um print — o bucket é
 * privado, então nunca se expõe uma URL pública fixa.
 */
export async function obterUrlPrint(path, segundosValidade = 300) {
  if (!path) return { url: null, erro: null }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundosValidade)
  if (error) return { url: null, erro: mensagem(error) }
  return { url: data?.signedUrl ?? null, erro: null }
}
