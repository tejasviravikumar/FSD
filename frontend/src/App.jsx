import { useEffect, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Check, GraduationCap } from 'lucide-react'
import { api, refreshSession, unwrap } from './api'
import { Login } from './auth/LoginPage'
import { ResetPasswordPage } from './auth/ResetPasswordPage'
import { Shell } from './layout/AppShell'
import { queryClient } from './app/queryClient'
import './App.css'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionGate />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function SessionGate() {
  const [session, setSession] = useState({ loading: true, user: null })
  const [toast, setToast] = useState(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // ---------------------------------------------------------------------------
  // Restore session on load; react to expiry events from the API client
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let active = true

    const expired = () => {
      api.clearToken()
      queryClient.clear()
      setSessionExpired(true)
      setSession({ loading: false, user: null })
      navigate('/login', { replace: true })
    }
    window.addEventListener('nexora:session-expired', expired)

    ;(async () => {
      try {
        await refreshSession()
        const profile = unwrap(await api.get('/auth/me'))
        if (active) setSession({ loading: false, user: profile?.user || profile })
      } catch {
        api.clearToken()
        queryClient.clear()
        if (active) setSession({ loading: false, user: null })
      }
    })()

    return () => {
      active = false
      window.removeEventListener('nexora:session-expired', expired)
    }
  }, [navigate])

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3600)
    return () => clearTimeout(timer)
  }, [toast])

  // ---------------------------------------------------------------------------
  // Sign in / out
  // ---------------------------------------------------------------------------
  const signIn = async credentials => {
    const result = unwrap(await api.post('/auth/login', credentials))
    api.setToken(result?.accessToken)
    const user = result?.user || unwrap(await api.get('/auth/me'))
    queryClient.clear()
    setSessionExpired(false)
    setSession({ loading: false, user })
    navigate('/', { replace: true })
  }

  const signOut = async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      /* local session is cleared even if the API is offline */
    }
    api.clearToken()
    queryClient.clear()
    setSession({ loading: false, user: null })
    navigate('/login', { replace: true })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (session.loading) {
    return (
      <div className="boot-screen">
        <div className="brand-mark">
          <GraduationCap size={23} />
        </div>
        <span>Opening your workspace</span>
        <div className="boot-line" />
      </div>
    )
  }

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            session.user ? (
              <Navigate to="/" replace />
            ) : (
              <Login onLogin={signIn} sessionExpired={sessionExpired} />
            )
          }
        />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/*"
          element={
            session.user ? (
              <Shell user={session.user} onLogout={signOut} notify={setToast} />
            ) : (
              <Navigate to="/login" state={{ from: location.pathname }} replace />
            )
          }
        />
      </Routes>

      <AnimatePresence>
        {toast && (
          <motion.div
            className={`toast ${toast.type || ''}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <Check size={16} />
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}