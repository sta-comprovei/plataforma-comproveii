import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import { PAGINAS } from '../../lib/permissions'
import { IconMenu } from '../ui/Icons'
import './AppLayout.css'

export default function AppLayout() {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const paginaAtual = PAGINAS.filter((p) => location.pathname.startsWith(p.path)).sort(
    (a, b) => b.path.length - a.path.length
  )[0]
  const titulo = paginaAtual?.label || 'Rastreamento de Reentrega'

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="app-main">
        <header className="app-topbar">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              className="topbar-menu-btn"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Abrir menu"
            >
              <IconMenu width={20} height={20} />
            </button>
            <h2>{titulo}</h2>
          </div>
        </header>

        <main className="app-page">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
