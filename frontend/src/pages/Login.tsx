import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getAuthenticatedUser, getGoogleSignInUrl } from '../auth'

const hasDevelopmentUser = Boolean(import.meta.env.DEV && import.meta.env.VITE_DEV_USER_ID?.trim())

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isChecking, setIsChecking] = useState(true)
  const [isStarting, setIsStarting] = useState(false)

  useEffect(() => {
    let active = true
    void getAuthenticatedUser().then(user => {
      if (!active) return
      if (user) navigate('/dashboard/scheduled', { replace: true })
      else setIsChecking(false)
    })
    return () => { active = false }
  }, [navigate])

  if (isChecking) {
    return <main className="grid min-h-screen place-items-center bg-white" role="status">Checking sign-in…</main>
  }

  const oauthError = searchParams.get('error')

  return (
    <main className="login-page grid min-h-screen place-items-center bg-white">
      <section className="login-card w-full max-w-sm" aria-labelledby="login-heading">
        <h1 id="login-heading" className="text-xl font-semibold">Login</h1>
        {oauthError && <p className="login-description" role="alert">Google sign-in could not be completed. Please try again.</p>}
        <button
          className="button button-google login-submit"
          type="button"
          disabled={isStarting}
          onClick={() => {
            setIsStarting(true)
            window.location.assign(getGoogleSignInUrl())
          }}
        >
          {!isStarting && <span className="google-mark" aria-hidden="true">G</span>}
          {isStarting ? 'Connecting to Google…' : 'Login with Google'}
        </button>
        <div className="form-divider"><span>or</span></div>
        <form className="login-fields" onSubmit={event => event.preventDefault()} aria-label="Email and password sign-in">
          <label className="input-field">
            <span className="sr-only">Email ID</span>
            <input className="input-control" type="email" placeholder="Email ID" disabled aria-label="Email ID" />
          </label>
          <label className="input-field">
            <span className="sr-only">Password</span>
            <input className="input-control" type="password" placeholder="Password" disabled aria-label="Password" />
          </label>
          <button
            className="button button-primary login-submit"
            type="button"
            disabled={!hasDevelopmentUser}
            onClick={() => navigate('/dashboard/scheduled')}
          >
            Login
          </button>
        </form>
      </section>
    </main>
  )
}
