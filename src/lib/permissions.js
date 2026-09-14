// Definição central de perfis e permissões.
export const PERFIS = {
  ADMINISTRADOR: 'administrador',
  OPERADOR:      'operador',
}

const A = PERFIS.ADMINISTRADOR
const O = PERFIS.OPERADOR

export const PAGINAS = [
  { path: '/reentregas', label: 'Reentregas', icon: 'reentregas', perfis: [A, O] },
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
