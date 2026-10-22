import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { api, unwrap } from '../api'
import { messageOf, records } from '../utils'

const fields = [
  ['domainId', 'Domain ID'],
  ['role', 'Role'],
  ['designation', 'Designation'],
  ['level', 'Level'],
  ['location', 'Location'],
  ['joinedWithinDays', 'Joined within days'],
  ['tag', 'Tag'],
]

const blankCondition = () => ({ field: 'domainId', operator: 'eq', value: '' })

const isListOperator = operator => ['in', 'not_in'].includes(operator)

function prettyOperator(op) {
  return { in: 'is one of', not_in: 'is not one of', gte: 'at least', lte: 'at most' }[op] || op
}

export function RuleBuilder({ onClose, onSaved, notify }) {
  const coursesQuery = useQuery({
    queryKey: ['published-courses'],
    queryFn: () => api.get('/courses?page=1&limit=100&status=published'),
  })
  const courses = records(unwrap(coursesQuery.data))

  const [name, setName] = useState('')
  const [courseId, setCourseId] = useState('')
  const [conditions, setConditions] = useState([blankCondition()])
  const [matchType, setMatchType] = useState('all')
  const [dueInDays, setDueInDays] = useState(30)
  const [recurrence, setRecurrence] = useState('none')
  const [months, setMonths] = useState(12)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Changing a condition's field resets its value
  const update = (index, key, value) =>
    setConditions(prev =>
      prev.map((condition, i) =>
        i === index
          ? { ...condition, [key]: value, ...(key === 'field' ? { value: '' } : {}) }
          : condition,
      ),
    )

  const save = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')

    const parsed = conditions.map(row => ({
      ...row,
      value:
        row.field === 'joinedWithinDays'
          ? Number(row.value)
          : isListOperator(row.operator)
            ? row.value
                .split(',')
                .map(value => value.trim())
                .filter(Boolean)
            : row.value,
    }))

    try {
      await api.post('/rules', {
        name,
        courseId,
        isActive: false,
        conditions: parsed,
        matchType,
        dueInDays: Number(dueInDays),
        recurrence:
          recurrence === 'custom'
            ? { type: 'custom', months: Number(months) }
            : { type: recurrence },
      })
      notify({ message: 'Draft rule created. Preview its matches before activation.' })
      onSaved()
      onClose()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="modal-form rule-form" onSubmit={save}>
      <p className="muted">
        Create a draft, preview its matching employees, then activate it when ready.
      </p>

      <label>
        Rule name
        <input
          required
          maxLength="120"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. New joiner onboarding"
        />
      </label>

      <label>
        Published course
        <select required value={courseId} onChange={e => setCourseId(e.target.value)}>
          <option value="">Choose course</option>
          {courses.map(course => (
            <option value={course._id} key={course._id}>
              {course.courseCode ? `${course.courseCode} · ` : ''}
              {course.title}
            </option>
          ))}
        </select>
      </label>

      <div className="condition-heading">
        <b>Conditions</b>
        <label>
          Match
          <select value={matchType} onChange={e => setMatchType(e.target.value)}>
            <option value="all">All conditions</option>
            <option value="any">Any condition</option>
          </select>
        </label>
      </div>

      {conditions.map((condition, index) => (
        <div className="condition-row" key={index}>
          <select
            aria-label="Condition field"
            value={condition.field}
            onChange={e => update(index, 'field', e.target.value)}
          >
            {fields.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            aria-label="Condition operator"
            value={condition.operator}
            onChange={e => update(index, 'operator', e.target.value)}
          >
            {(condition.field === 'joinedWithinDays' ? ['gte', 'lte'] : ['eq', 'in', 'not_in']).map(
              op => (
                <option key={op} value={op}>
                  {op === 'eq' ? 'is' : prettyOperator(op)}
                </option>
              ),
            )}
          </select>

          <input
            aria-label="Condition value"
            required
            type={condition.field === 'joinedWithinDays' ? 'number' : 'text'}
            value={condition.value}
            onChange={e => update(index, 'value', e.target.value)}
            placeholder={
              isListOperator(condition.operator)
                ? 'Comma-separated values'
                : condition.field === 'domainId'
                  ? '24-character domain ID'
                  : 'Value'
            }
          />

          <button
            type="button"
            className="icon-button"
            aria-label="Remove condition"
            disabled={conditions.length === 1}
            onClick={() => setConditions(prev => prev.filter((_, i) => i !== index))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <button
        type="button"
        className="text-button"
        disabled={conditions.length >= 20}
        onClick={() => setConditions(prev => [...prev, blankCondition()])}
      >
        <Plus size={14} /> Add condition
      </button>

      <div className="form-pair">
        <label>
          Due in (days)
          <input
            type="number"
            min="0"
            max="3650"
            value={dueInDays}
            onChange={e => setDueInDays(e.target.value)}
          />
        </label>
        <label>
          Recurrence
          <select value={recurrence} onChange={e => setRecurrence(e.target.value)}>
            <option value="none">No recurrence</option>
            <option value="annual">Annual</option>
            <option value="custom">Custom interval</option>
          </select>
        </label>
      </div>

      {recurrence === 'custom' && (
        <label>
          Repeat every (months)
          <input
            type="number"
            min="1"
            max="120"
            value={months}
            onChange={e => setMonths(e.target.value)}
          />
        </label>
      )}

      {error && (
        <div className="form-message" role="alert">
          {error}
        </div>
      )}
      {coursesQuery.error && (
        <div className="form-message" role="alert">
          {messageOf(coursesQuery.error)}
        </div>
      )}

      <div className="modal-actions">
        <button className="button primary" disabled={busy || coursesQuery.isLoading || !courseId}>
          {busy ? 'Saving...' : 'Create draft rule'}
        </button>
      </div>
    </form>
  )
}