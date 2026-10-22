import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function PasswordField({
  className = '',
  ...inputProps
}) {
  const [visible, setVisible] = useState(false)

  return (
    <span
      className={`password-field ${className}`.trim()}
    >
      <input
        {...inputProps}
        type={visible ? 'text' : 'password'}
      />

      <button
        className="password-toggle"
        type="button"
        aria-label={
          visible ? 'Hide password' : 'Show password'
        }
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? (
          <EyeOff size={16} />
        ) : (
          <Eye size={16} />
        )}
      </button>
    </span>
  )
}