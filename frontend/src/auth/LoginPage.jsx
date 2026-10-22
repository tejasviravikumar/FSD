import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, GraduationCap, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { PasswordField } from '../components/PasswordField'
import { messageOf } from '../utils'

export function Login({ onLogin, sessionExpired = false }) {
  const [error, setError] = useState('')
  const [forgot, setForgot] = useState(false)

  const schema = useMemo(
    () =>
      z.object({
        email: z.string().trim().email('Enter a valid work email.'),
        password: forgot
          ? z.string().optional()
          : z.string().min(1, 'Enter your password.'),
      }),
    [forgot]
  )

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const submit = async (values) => {
    setError('')

    try {
      if (forgot) {
        await api.post('/auth/forgot-password', {
          email: values.email,
        })

        setError(
          'If that account exists, a reset link has been sent.'
        )
      } else {
        await onLogin({
          email: values.email,
          password: values.password,
        })
      }
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <main className="login-page">
      <div className="login-brand">
        <div className="brand-mark">
          <GraduationCap size={25} />
        </div>

        <span>
          NEXORA
          <span className="brand-light"> / LEARNING</span>
        </span>
      </div>

      <div className="login-layout">
        <section className="login-story">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            PEOPLE DEVELOPMENT, IN MOTION
          </div>

          <h1>
            Grow your skills.
            <br />
            <em>Shape what&apos;s next.</em>
          </h1>

          <p>
            A clear path to the knowledge, confidence and certifications
            that move your career forward.
          </p>

          <div className="story-stat">
            <div className="avatar-stack">
              <span>JD</span>
              <span>MK</span>
              <span>AS</span>
              <span>+2k</span>
            </div>

            <div>
              <strong>Learning that moves with you</strong>
              <small>One workspace. Every next step.</small>
            </div>
          </div>

          <div className="login-orbit orbit-one" />
          <div className="login-orbit orbit-two" />
          <div className="story-star">*</div>
        </section>

        <section className="login-card">
          <span className="form-kicker">YOUR WORKSPACE</span>

          <h2>
            {forgot ? 'Reset your password' : 'Welcome back'}
          </h2>

          <p>
            {forgot
              ? "Enter your work email and we'll send a reset link."
              : 'Sign in to continue your learning journey.'}
          </p>

          <form onSubmit={handleSubmit(submit)} noValidate>
            <label>
              Work email

              <input
                autoComplete="email"
                type="email"
                {...register('email')}
                placeholder="you@nexora.com"
                aria-invalid={!!errors.email}
              />

              {errors.email && (
                <small className="field-error">
                  {errors.email.message}
                </small>
              )}
            </label>

            {!forgot && (
              <label>
                Password

                <PasswordField
                  autoComplete="current-password"
                  {...register('password')}
                  placeholder="Enter your password"
                  aria-invalid={!!errors.password}
                />

                {errors.password && (
                  <small className="field-error">
                    {errors.password.message}
                  </small>
                )}
              </label>
            )}

            {sessionExpired && !forgot && (
              <div className="form-message" role="status">
                Your session expired. Sign in again to open your workspace.
              </div>
            )}

            {error && (
              <div className="form-message" role="alert">
                {error}
              </div>
            )}

            <button
              className="button primary full"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? 'Please wait...'
                : forgot
                  ? 'Send reset link'
                  : 'Sign in'}

              <ArrowRight size={16} />
            </button>
          </form>

          <button
            className="text-button forgot"
            onClick={() => {
              setForgot(!forgot)
              setError('')
              reset()
            }}
          >
            {forgot ? 'Back to sign in' : 'Forgot password?'}
          </button>

          <div className="login-bottom">
            <ShieldCheck size={15} />
            Your account is protected with secure sign-in
          </div>
        </section>
      </div>

      <footer className="login-footer">
        <span>
          Copyright {new Date().getFullYear()} Nexora Industries
        </span>
        <span>Learning &amp; Development</span>
      </footer>
    </main>
  )
}