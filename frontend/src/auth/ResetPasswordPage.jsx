import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, CheckCircle2, GraduationCap } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { PasswordField } from '../components/PasswordField'
import { messageOf } from '../utils'

const schema = z
  .object({
    password: z.string().min(10, 'Use at least 10 characters.'),
    confirm: z.string(),
  })
  .refine(
    (value) => value.password === value.confirm,
    {
      path: ['confirm'],
      message: 'Passwords do not match.',
    }
  )

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const navigate = useNavigate()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
  })

  const submit = async ({ password }) => {
    setError('')

    try {
      await api.post('/auth/reset-password', {
        token: params.get('token'),
        password,
      })

      setSuccess(true)

      setTimeout(
        () => navigate('/login', { replace: true }),
        1800
      )
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <main className="reset-page">
      <div className="login-brand">
        <div className="brand-mark">
          <GraduationCap size={25} />
        </div>

        <span>
          NEXORA
          <span className="brand-light"> / LEARNING</span>
        </span>
      </div>

      <section className="login-card reset-card">
        <span className="form-kicker">ACCOUNT SECURITY</span>

        <h2>
          {success
            ? 'Password updated'
            : 'Choose a new password'}
        </h2>

        <p>
          {success
            ? 'Your password has been changed. Taking you back to sign in...'
            : 'Create a new password to securely return to your workspace.'}
        </p>

        {success ? (
          <div className="reset-success">
            <CheckCircle2 size={28} />
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(submit)}
            noValidate
          >
            <label>
              New password

              <PasswordField
                autoComplete="new-password"
                {...register('password')}
                aria-invalid={!!errors.password}
              />

              {errors.password && (
                <small className="field-error">
                  {errors.password.message}
                </small>
              )}
            </label>

            <label>
              Confirm password

              <PasswordField
                autoComplete="new-password"
                {...register('confirm')}
                aria-invalid={!!errors.confirm}
              />

              {errors.confirm && (
                <small className="field-error">
                  {errors.confirm.message}
                </small>
              )}
            </label>

            {error && (
              <div
                className="form-message"
                role="alert"
              >
                {error}
              </div>
            )}

            <button
              className="button primary full"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? 'Saving...'
                : 'Update password'}

              <ArrowRight size={16} />
            </button>
          </form>
        )}

        <Link
          className="text-button forgot"
          to="/login"
        >
          Back to sign in
        </Link>
      </section>
    </main>
  )
}