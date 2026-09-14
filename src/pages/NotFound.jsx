import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        textAlign: 'center',
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 48, fontWeight: 800, color: 'var(--orange)' }}>404</h1>
      <p style={{ color: 'var(--text3)', fontSize: 14 }}>Página não encontrada.</p>
      <Link
        to="/dashboard"
        style={{
          marginTop: 8,
          padding: '9px 18px',
          borderRadius: 8,
          background: 'var(--orange)',
          color: '#fff',
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        Voltar ao Dashboard
      </Link>
    </div>
  )
}
