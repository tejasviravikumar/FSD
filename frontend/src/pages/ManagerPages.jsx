import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Plus, Search, Users } from 'lucide-react'
import { api, unwrap } from '../api'
import { date, initials, messageOf, pretty, records, statusClass } from '../utils'
import { DataTable, EmptyState, ErrorNotice, Modal, PageHeading } from '../components/ui'

export function TeamPage({ notify }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showAssign, setShowAssign] = useState(false)
  const [courseId, setCourseId] = useState('')
  const [dueDate, setDueDate] = useState('')

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  const peopleQuery = useQuery({
    queryKey: ['team', search],
    queryFn: () =>
      api.get(`/users?page=1&limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  })
  const coursesQuery = useQuery({
    queryKey: ['team-courses'],
    queryFn: () => api.get('/courses?page=1&limit=100&status=published'),
    enabled: showAssign,
  })
  const people = records(unwrap(peopleQuery.data))
  const courses = records(unwrap(coursesQuery.data))

  // ---------------------------------------------------------------------------
  // Assign learning
  // ---------------------------------------------------------------------------
  const assign = useMutation({
    mutationFn: () =>
      api.post('/assignments', {
        courseId,
        employeeIds: people.map(p => p._id),
        ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] })
      setShowAssign(false)
      setCourseId('')
      setDueDate('')
      notify({ message: 'Course assigned to your team' })
    },
    onError: e => notify({ message: messageOf(e), type: 'error' }),
  })

  // ---------------------------------------------------------------------------
  // Table columns
  // ---------------------------------------------------------------------------
  const columns = [
    {
      key: 'name',
      label: 'Team member',
      render: row => (
        <span className="table-primary">
          <span className="user-avatar tiny">{initials(row.name)}</span>
          <span>
            <b>{row.name}</b>
            <small>{row.email}</small>
          </span>
        </span>
      ),
    },
    {
      key: 'designation',
      label: 'Role',
      render: row => row.designation || pretty(row.role || 'employee'),
    },
    { key: 'domain', label: 'Domain', render: row => row.domain?.name || '—' },
    { key: 'location', label: 'Location' },
    {
      key: 'status',
      label: 'Status',
      render: row => (
        <span className={statusClass(row.status || 'active')}>{pretty(row.status || 'active')}</span>
      ),
    },
  ]

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <PageHeading
        eyebrow="PEOPLE LEADERSHIP"
        title="My team"
        description="Support your reportees with clear learning plans and timely follow-up."
        action={
          <button
            className="button primary"
            onClick={() => setShowAssign(true)}
            disabled={!people.length}
          >
            <Plus size={16} /> Assign learning
          </button>
        }
      />

      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="Search your team"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="muted">{people.length} reportees</span>
      </div>

      <ErrorNotice error={peopleQuery.error} />

      <section className="panel table-panel">
        {peopleQuery.isLoading ? (
          <div className="table-skeleton" />
        ) : people.length ? (
          <DataTable rows={people} columns={columns} />
        ) : (
          <EmptyState
            icon={Users}
            title="No reportees found"
            detail="Your active direct reportees appear here."
          />
        )}
      </section>

      {showAssign && (
        <Modal title="Assign learning to your team" onClose={() => setShowAssign(false)}>
          <form
            className="modal-form"
            onSubmit={e => {
              e.preventDefault()
              assign.mutate()
            }}
          >
            <p className="muted">
              This assignment will be created for {people.length} active reportees.
            </p>

            <label>
              Published course
              <select required value={courseId} onChange={e => setCourseId(e.target.value)}>
                <option value="">Select a course</option>
                {courses.map(course => (
                  <option key={course._id} value={course._id}>
                    {course.courseCode ? `${course.courseCode} · ` : ''}
                    {course.title}
                  </option>
                ))}
              </select>
            </label>

            {coursesQuery.error && <ErrorNotice error={coursesQuery.error} />}

            <label>
              Due date
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </label>

            <div className="modal-actions">
              <button className="button primary" disabled={!courseId || assign.isPending}>
                {assign.isPending ? 'Assigning...' : 'Assign to team'} <ArrowRight size={15} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}