import { useState } from 'react'
import {
  PERFIS_USUARIO,
  criarUsuario,
  atualizarDadosUsuario,
  atualizarEmailUsuario,
  redefinirSenha,
} from '../lib/usuariosService'
import Button from '../components/ui/Button'
import { IconAlertCircle, IconLock } from '../components/ui/Icons'

/**
 * Formulário reutilizável para criar e editar usuários.
 * Modo criação: exibe campo de senha obrigatório.
 * Modo edição: senha é opcional (seção separada de redefinição).
 */
export default function UsuarioForm({ usuario, onSalvo, onCancelar }) {
  const editando = !!usuario

  const [nome,   setNome]   = useState(usuario?.nome   ?? '')
  const [email,  setEmail]  = useState(usuario?.email  ?? '')
  const [perfil, setPerfil] = useState(usuario?.perfil ?? 'operador')
  const [ativo,  setAtivo]  = useState(usuario?.ativo  ?? true)

  // Campos de senha — criação
  const [senha,       setSenha]       = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')

  // Redefinição de senha — edição
  const [novaSenha,       setNovaSenha]       = useState('')
  const [confirmarNovaSenha, setConfirmarNovaSenha] = useState('')
  const [mostrarRedefinir,   setMostrarRedefinir]   = useState(false)

  const [salvando,   setSalvando]   = useState(false)
  const [erro,       setErro]       = useState('')
  const [erros,      setErros]      = useState({})

  function validar() {
    const e = {}
    if (!nome.trim())  e.nome  = 'Nome é obrigatório.'
    if (!email.trim()) e.email = 'E-mail é obrigatório.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      e.email = 'E-mail inválido.'
    if (!perfil) e.perfil = 'Selecione um perfil.'

    if (!editando) {
      if (!senha) e.senha = 'Senha é obrigatória.'
      else if (senha.length < 8) e.senha = 'Mínimo de 8 caracteres.'
      if (senha && senha !== confirmarSenha) e.confirmarSenha = 'As senhas não coincidem.'
    }
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function handleSalvar() {
    setErro('')
    if (!validar()) return

    setSalvando(true)

    let resultado
    if (editando) {
      // Atualizar dados básicos (nome, perfil, ativo) via RPC
      resultado = await atualizarDadosUsuario(usuario.id, {
        nome: nome.trim(),
        perfil,
        ativo,
      })
      // Se email mudou, atualizar via Edge Function (Admin API)
      if (!resultado.erro && email.trim().toLowerCase() !== (usuario.email || '').toLowerCase()) {
        resultado = await atualizarEmailUsuario(usuario.id, email.trim().toLowerCase())
      }
    } else {
      resultado = await criarUsuario({
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        senha,
        perfil,
      })
    }

    setSalvando(false)
    if (resultado.erro) { setErro(resultado.erro); return }

    // Redefinir senha se preenchida (modo edição)
    if (editando && mostrarRedefinir && novaSenha) {
      const { erro: erroSenha } = await redefinirSenha(usuario.id, novaSenha)
      if (erroSenha) { setErro(`Dados salvos, mas a senha não pôde ser alterada: ${erroSenha}`); return }
    }

    onSalvo()
  }

  function Campo({ label, children, erro: erroC }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text2)' }}>{label}</label>
        {children}
        {erroC && (
          <span style={{ fontSize: 12, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <IconAlertCircle width={12} height={12} /> {erroC}
          </span>
        )}
      </div>
    )
  }

  const inputStyle = (err) => ({
    padding: '8px 10px',
    border: `1.5px solid ${err ? 'var(--red)' : 'var(--border)'}`,
    borderRadius: 'var(--radius2)',
    fontSize: 13.5,
    color: 'var(--text)',
    background: 'var(--bg)',
    outline: 'none',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
      {/* Nome */}
      <Campo label="Nome completo *" erro={erros.nome}>
        <input
          type="text"
          value={nome}
          onChange={e => { setNome(e.target.value); setErros(p => ({...p, nome: undefined})) }}
          placeholder="Ex: João Silva"
          style={inputStyle(erros.nome)}
          disabled={salvando}
          autoFocus
        />
      </Campo>

      {/* E-mail */}
      <Campo label="E-mail *" erro={erros.email}>
        <input
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setErros(p => ({...p, email: undefined})) }}
          placeholder="Ex: joao@empresa.com.br"
          style={inputStyle(erros.email)}
          disabled={salvando}
        />
      </Campo>

      {/* Perfil + Situação lado a lado */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Campo label="Perfil *" erro={erros.perfil}>
          <select
            value={perfil}
            onChange={e => { setPerfil(e.target.value); setErros(p => ({...p, perfil: undefined})) }}
            style={{ ...inputStyle(erros.perfil), cursor: 'pointer' }}
            disabled={salvando}
          >
            {PERFIS_USUARIO.map(p => (
              <option key={p.valor} value={p.valor}>{p.label}</option>
            ))}
          </select>
        </Campo>

        {editando && (
          <Campo label="Situação">
            <select
              value={ativo ? 'ativo' : 'inativo'}
              onChange={e => setAtivo(e.target.value === 'ativo')}
              style={{ ...inputStyle(), cursor: 'pointer' }}
              disabled={salvando}
            >
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </Campo>
        )}
      </div>

      {/* Senha — criação */}
      {!editando && (
        <>
          <Campo label="Senha * (mínimo 8 caracteres)" erro={erros.senha}>
            <input
              type="password"
              value={senha}
              onChange={e => { setSenha(e.target.value); setErros(p => ({...p, senha: undefined})) }}
              placeholder="••••••••"
              style={inputStyle(erros.senha)}
              disabled={salvando}
            />
          </Campo>
          <Campo label="Confirmar senha *" erro={erros.confirmarSenha}>
            <input
              type="password"
              value={confirmarSenha}
              onChange={e => { setConfirmarSenha(e.target.value); setErros(p => ({...p, confirmarSenha: undefined})) }}
              placeholder="••••••••"
              style={inputStyle(erros.confirmarSenha)}
              disabled={salvando}
            />
          </Campo>
        </>
      )}

      {/* Redefinir senha — edição */}
      {editando && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <button
            type="button"
            onClick={() => setMostrarRedefinir(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              color: 'var(--orange)', fontSize: 13, fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            <IconLock width={14} height={14} />
            {mostrarRedefinir ? 'Cancelar redefinição de senha' : 'Redefinir senha'}
          </button>

          {mostrarRedefinir && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Campo label="Nova senha (mínimo 8 caracteres)">
                <input
                  type="password"
                  value={novaSenha}
                  onChange={e => setNovaSenha(e.target.value)}
                  placeholder="••••••••"
                  style={inputStyle()}
                  disabled={salvando}
                />
              </Campo>
              <Campo label="Confirmar nova senha">
                <input
                  type="password"
                  value={confirmarNovaSenha}
                  onChange={e => setConfirmarNovaSenha(e.target.value)}
                  placeholder="••••••••"
                  style={inputStyle(novaSenha && confirmarNovaSenha && novaSenha !== confirmarNovaSenha)}
                  disabled={salvando}
                />
                {novaSenha && confirmarNovaSenha && novaSenha !== confirmarNovaSenha && (
                  <span style={{ fontSize: 12, color: 'var(--red)' }}>As senhas não coincidem.</span>
                )}
              </Campo>
            </div>
          )}
        </div>
      )}

      {/* Erro geral */}
      {erro && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-start',
          background: 'var(--red-bg)', color: 'var(--red)',
          padding: '10px 12px', borderRadius: 'var(--radius2)', fontSize: 13,
        }}>
          <IconAlertCircle width={15} height={15} style={{ flexShrink: 0, marginTop: 1 }} />
          {erro}
        </div>
      )}

      {/* Ações */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <Button variant="ghost" onClick={onCancelar} disabled={salvando} style={{ flex: 1 }}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          onClick={handleSalvar}
          carregando={salvando}
          disabled={salvando}
          style={{ flex: 2 }}
        >
          {editando ? 'Salvar alterações' : 'Criar usuário'}
        </Button>
      </div>
    </div>
  )
}
