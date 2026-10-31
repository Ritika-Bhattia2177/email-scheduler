import { useEffect, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import Login from '../pages/Login'
import DashboardLayout from '../components/layout/DashboardLayout'
import ScheduledEmails from '../pages/ScheduledEmails'
import SentEmails from '../pages/SentEmails'
import EmailDetail from '../pages/EmailDetail'
import ComposeEmail from '../pages/ComposeEmail'
import SlackIntegration from '../pages/SlackIntegration'
import { getAuthenticatedUser, type AuthenticatedUser } from '../auth'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuthentication />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="scheduled" replace />} />
          <Route path="scheduled" element={<ScheduledEmails />} />
          <Route path="sent" element={<SentEmails />} />
          <Route path="email/:id" element={<EmailDetail />} />
          <Route path="integrations/slack" element={<SlackIntegration />} />
        </Route>
        <Route path="/compose" element={<DashboardLayout />}>
          <Route index element={<ComposeRoute />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

function ComposeRoute() {
  const location = useLocation()
  const newComposeId = (location.state as { newComposeId?: string } | null)?.newComposeId
  return <ComposeEmail key={newComposeId ?? location.key} />
}

function RequireAuthentication() {
  const [isChecking, setIsChecking] = useState(true)
  const [user, setUser] = useState<AuthenticatedUser | null>(null)

  useEffect(() => {
    let active = true
    void getAuthenticatedUser().then(user => {
      if (!active) return
      setUser(user)
      setIsChecking(false)
    })
    return () => { active = false }
  }, [])

  if (isChecking) return <main className="grid min-h-screen place-items-center">Checking sign-in…</main>
  if (!user) return <Navigate to="/login" replace />
  return <Outlet context={user} />
}
