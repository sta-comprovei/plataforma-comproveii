import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { IconLock, IconEye, IconEyeOff } from '../components/ui/Icons'
import comproveiLogo from '../assets/comprovei-logo.jpg'
import './Login.css'

export default function RedefinirSenha() {
  const { atualizarSenha } = useAuth()
  const navigate = useNavigate()

  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')

    if (senha.length < 6) {
      setErro('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (senha !== confirmar) {
      setErro('As senhas informadas não coincidem.')
      return
    }

    setCarregando(true)
    const resultado = await atualizarSenha(senha)
    setCarregando(false)

    if (!resultado.sucesso) {
      setErro(resultado.mensagem)
      return
    }

    setSucesso(true)
    setTimeout(() => navigate('/reentregas', { replace: true }), 1800)
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <img src={comproveiLogo} alt="COMPROVEI by nstech" />
          <span className="login-brand-name">Rastreamento de Reentrega</span>
          <span className="login-brand-by">By Giovanna Lopes · Comprovei Entregas</span>
        </div>

        <div className="login-heading">
          <h1>Crie uma nova senha</h1>
          <p>Defina uma nova senha de acesso para a sua conta.</p>
        </div>

        {sucesso ? (
          <div className="login-success" style={{ width: '100%' }}>
            ✓ Senha atualizada com sucesso! Redirecionando...
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="nova-senha">Nova senha</label>
              <div className="login-input-wrap">
                <IconLock />
                <input
                  id="nova-senha"
                  type={mostrarSenha ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Mínimo 6 caracteres"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  disabled={carregando}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setMostrarSenha((v) => !v)}
                  tabIndex={-1}
                  aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {mostrarSenha ? <IconEyeOff width={17} height={17} /> : <IconEye width={17} height={17} />}
                </button>
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="confirmar-senha">Confirmar nova senha</label>
              <div className="login-input-wrap">
                <IconLock />
                <input
                  id="confirmar-senha"
                  type={mostrarSenha ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repita a nova senha"
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
                  disabled={carregando}
                />
              </div>
            </div>

            {erro && <div className="login-error">{erro}</div>}

            <button type="submit" className="login-submit" disabled={carregando}>
              {carregando ? (
                <>
                  <span className="login-spinner" />
                  Salvando...
                </>
              ) : (
                'Salvar nova senha'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
