import { Routes, Route, Navigate } from 'react-router-dom'
import Login from '../pages/Login'
import RedefinirSenha from '../pages/RedefinirSenha'
import Reentregas from '../pages/Reentregas'
import NotFound from '../pages/NotFound'
import AppLayout from '../components/layout/AppLayout'
import RequireAuth from '../components/layout/RequireAuth'
import RequireProfile from '../components/layout/RequireProfile'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/redefinir-senha" element={<RedefinirSenha />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="/reentregas" element={<RequireProfile><Reentregas /></RequireProfile>} />
      </Route>
      <Route path="/" element={<Navigate to="/reentregas" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
