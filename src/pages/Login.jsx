import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { IconMail, IconLock, IconEye, IconEyeOff } from '../components/ui/Icons'
import comproveiLogo from '../assets/comprovei-logo.jpg'
import './Login.css'

export default function Login() {
  const { login, autenticado, carregandoSessao } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  const [modoRecuperar, setModoRecuperar] = useState(false)

  // Se já está autenticado, não faz sentido mostrar o login novamente.
  if (!carregandoSessao && autenticado) {
    return <Navigate to="/reentregas" replace />
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')

    if (!email.trim() || !senha) {
      setErro('Informe e-mail e senha para continuar.')
      return
    }

    setCarregando(true)
    const resultado = await login(email, senha)
    setCarregando(false)

    if (!resultado.sucesso) {
      setErro(resultado.mensagem)
      return
    }

    navigate('/reentregas', { replace: true })
  }

  if (modoRecuperar) {
    return <RecuperarSenhaView onVoltar={() => setModoRecuperar(false)} emailInicial={email} />
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
          <h1>Bem-vindo de volta</h1>
          <p>Faça login para acessar a plataforma Rastreamento de Reentrega.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="email">E-mail</label>
            <div className="login-input-wrap">
              <IconMail />
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="seuemail@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={carregando}
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="senha">Senha</label>
            <div className="login-input-wrap">
              <IconLock />
              <input
                id="senha"
                type={mostrarSenha ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Sua senha"
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

          {erro && <div className="login-error">{erro}</div>}

          <button type="submit" className="login-submit" disabled={carregando}>
            {carregando ? (
              <>
                <span className="login-spinner" />
                Entrando...
              </>
            ) : (
              'Entrar no sistema'
            )}
          </button>
        </form>

        <div className="login-footer">
          <button type="button" className="login-link-btn" onClick={() => setModoRecuperar(true)}>
            Esqueceu sua senha?
          </button>
          <div className="login-divider" />
          <p className="login-help-text">
            Não possui acesso? Entre em contato com o administrador.
          </p>
        </div>
      </div>
    </div>
  )
}

function RecuperarSenhaView({ onVoltar, emailInicial }) {
  const { solicitarRedefinicaoSenha } = useAuth()
  const [email, setEmail] = useState(emailInicial || '')
  const [carregando, setCarregando] = useState(false)
  const [mensagem, setMensagem] = useState(null) // { tipo: 'success' | 'error', texto }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) {
      setMensagem({ tipo: 'error', texto: 'Informe seu e-mail cadastrado.' })
      return
    }
    setCarregando(true)
    setMensagem(null)
    const resultado = await solicitarRedefinicaoSenha(email)
    setCarregando(false)
    setMensagem({
      tipo: resultado.sucesso ? 'success' : 'error',
      texto: resultado.mensagem,
    })
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
          <h1>Redefinir senha</h1>
          <p>Informe seu e-mail cadastrado. Enviaremos um link para você criar uma nova senha.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="email-recuperar">E-mail</label>
            <div className="login-input-wrap">
              <IconMail />
              <input
                id="email-recuperar"
                type="email"
                autoComplete="email"
                placeholder="seuemail@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={carregando}
              />
            </div>
          </div>

          {mensagem && (
            <div className={mensagem.tipo === 'success' ? 'login-success' : 'login-error'}>
              {mensagem.texto}
            </div>
          )}

          <button type="submit" className="login-submit" disabled={carregando}>
            {carregando ? (
              <>
                <span className="login-spinner" />
                Enviando...
              </>
            ) : (
              'Enviar link de redefinição'
            )}
          </button>
        </form>

        <div className="login-footer">
          <button type="button" className="login-link-btn" onClick={onVoltar}>
            ← Voltar para o login
          </button>
        </div>
      </div>
    </div>
  )
}
