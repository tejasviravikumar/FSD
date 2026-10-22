import { useState } from 'react'
import { Activity } from 'lucide-react'
import { api } from '../api'
import { messageOf, pretty } from '../utils'

const JOBS = [
  ['nightly', 'Nightly reconciliation'],
  ['reminders', 'Daily reminders'],
  ['youtube', 'YouTube availability'],
]

export function JobsPanel({ notify }) {
  const [running, setRunning] = useState('')

  const run = async name => {
    setRunning(name)
    try {
      await api.post(`/admin/jobs/${name}/run`)
      notify({ message: `${pretty(name)} job completed` })
    } catch (error) {
      notify({ message: messageOf(error), type: 'error' })
    } finally {
      setRunning('')
    }
  }

  return (
    <section className="panel job-panel">
      <div>
        <span className="eyebrow small-eyebrow">OPERATIONS</span>
        <h2>Run a scheduled job</h2>
        <p>Manual runs use the same idempotent handlers as scheduled jobs.</p>
      </div>

      <div className="job-actions">
        {JOBS.map(([name, label]) => (
          <button
            key={name}
            className="button outline"
            disabled={!!running}
            onClick={() => run(name)}
          >
            <Activity size={15} />
            {running === name ? 'Running...' : label}
          </button>
        ))}
      </div>
    </section>
  )
}