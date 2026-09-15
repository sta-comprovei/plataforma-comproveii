// Definição central de perfis e permissões.
export const PERFIS = {
  ADMINISTRADOR: 'administrador',
  OPERADOR:      'operador',
  VISUALIZADOR:  'visualizador', // só enxerga as reentregas — não cria, não edita, não exclui
}

const A = PERFIS.ADMINISTRADOR
const O = PERFIS.OPERADOR
const V = PERFIS.VISUALIZADOR

export const PAGINAS = [
  { path: '/reentregas', label: 'Reentregas', icon: 'reentregas', perfis: [A, O, V] },
]

export function paginasPermitidas(perfil) {
  return PAGINAS.filter(p => p.perfis.includes(perfil) && !p.ocultoNoMenu)
}

export function podeAcessar(path, perfil) {
  const pagina = PAGINAS.find(p => p.path === path)
  if (!pagina) return false
  return pagina.perfis.includes(perfil)
}

export const PODE = {
  criar:   [A, O],
  editar:  [A, O],
  excluir: [A],
}

export function podeFazer(acao, perfil) {
  return (PODE[acao] ?? []).includes(perfil)
}
