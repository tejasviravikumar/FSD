import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Filter, Plus, Search, Trash2 } from 'lucide-react'
import { api, unwrap } from '../api'
import { date, messageOf, pretty, records, statusClass } from '../utils'
import { DataTable, EmptyState, ErrorNotice, Modal, PageHeading } from '../components/ui'
import { CourseBuilder } from './CourseBuilder'

const STATUSES = ['draft', 'under_review', 'published', 'archived', 'rejected']

export function CoursesPage({ role, user, notify, onSelectCourse }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingCourseId, setEditingCourseId] = useState(null)
  const query = useQuery({
    queryKey: ['courses-page', role, status, search],
    queryFn: () =>
      api.get(
        `/courses?page=1&limit=50${status ? `&status=${encodeURIComponent(status)}` : ''}${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`,
      ),
  })
  const rows = records(unwrap(query.data))

  const submit = useMutation({
    mutationFn: id => api.post(`/courses/${id}/submit`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courses-page'] })
      notify({ message: 'Course sent for review' })
    },
    onError: e => notify({ message: messageOf(e), type: 'error' }),
  })

  const remove = useMutation({
    mutationFn: id => api.delete(`/courses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courses-page'] })
      qc.invalidateQueries({ queryKey: ['courses'] })
      qc.invalidateQueries({ queryKey: ['assignments'] })
      qc.invalidateQueries({ queryKey: ['assignments-me'] })
      notify({ message: 'Course and employee assignments deleted' })
    },
    onError: e => notify({ message: messageOf(e), type: 'error' }),
  })

  const enroll = useMutation({
    mutationFn: id => api.post(`/courses/${id}/enroll`),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ['assignments-me'] })
      qc.invalidateQueries({ queryKey: ['courses'] })
      onSelectCourse?.(unwrap(result))
      notify({ message: 'Course opened in your learning plan' })
    },
    onError: e => notify({ message: messageOf(e), type: 'error' }),
  })

  const allowedCreate = role === 'trainer'

  const closeBuilder = () => {
    setShowCreate(false)
    setEditingCourseId(null)
  }

  const renderActions = row => {
    const ownsCourse = String(row.trainerId?._id || row.trainerId) === String(user?._id)
    const editable =
      role === 'trainer' && ['draft', 'rejected'].includes(row.status) && ownsCourse
    const canDelete =
      role === 'admin' || (role === 'trainer' && row.status === 'draft' && ownsCourse)

    return (
      <span className="rule-actions">
        {editable && (
          <button
            className="mini-button"
            onClick={e => {
              e.stopPropagation()
              setEditingCourseId(row._id)
            }}
          >
            Edit
          </button>
        )}

        {editable && (
          <button
            className="mini-button"
            onClick={e => {
              e.stopPropagation()
              submit.mutate(row._id)
            }}
          >
            Submit for review
          </button>
        )}

        {canDelete && (
          <button
            className="mini-button danger"
            disabled={remove.isPending}
            onClick={e => {
              e.stopPropagation()
              if (
                window.confirm(
                  `Delete course “${row.title}”? This removes its saved course data and related records.`,
                )
              ) {
                remove.mutate(row._id)
              }
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
        )}

        {!editable && !canDelete && role !== 'admin' && (
          <span className="muted">{row.moduleCount ?? row.modules?.length ?? '—'} modules</span>
        )}
      </span>
    )
  }

  const columns = [
    {
      key: 'title',
      label: 'Course',
      render: row => (
        <span className="table-primary">
          <span className="table-icon">
            <BookOpen size={16} />
          </span>
          <span>
            <b>{row.title}</b>
            <small>
              {row.courseCode || 'Course code pending'} ·{' '}
              {row.domain?.name || row.domainName || 'Learning course'}
            </small>
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: row => (
        <span className={statusClass(row.status)}>
          {role === 'employee' ? 'Available' : pretty(row.status)}
        </span>
      ),
    },
    { key: 'version', label: 'Version' },
    { key: 'updatedAt', label: 'Last updated', render: row => date(row.updatedAt) },
    { key: 'actions', label: '', render: renderActions },
  ]

  const emptyDetail =
    role === 'employee'
      ? 'Available courses for your domain will appear here.'
      : role === 'trainer'
        ? 'Create a course draft to start building a learning experience.'
        : 'Courses created by trainers will appear here for review and management.'

  return (
    <>
      <PageHeading
        eyebrow={role === 'trainer' ? 'TRAINER STUDIO' : 'LEARNING CATALOG'}
        title={role === 'trainer' ? 'My courses' : 'Courses'}
        description={
          role === 'trainer'
            ? 'Build, refine and publish learning for your domain.'
            : 'Manage the learning experiences available at Nexora.'
        }
        action={
          allowedCreate && (
            <button className="button primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> New course
            </button>
          )
        }
      />

      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="Search courses"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <label className="select-wrap">
          <Filter size={15} />
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorNotice error={query.error || enroll.error} />

      <section className="panel table-panel">
        {query.isLoading ? (
          <div className="table-skeleton" />
        ) : rows.length ? (
          <DataTable
            rows={rows}
            columns={columns}
            onSelect={
              role === 'employee'
                ? row => {
                    if (!enroll.isPending) enroll.mutate(row._id)
                  }
                : undefined
            }
          />
        ) : (
          <EmptyState
            icon={BookOpen}
            title="No courses found"
            detail={emptyDetail}
            action={
              allowedCreate && (
                <button className="button primary" onClick={() => setShowCreate(true)}>
                  <Plus size={15} /> Create course
                </button>
              )
            }
          />
        )}
      </section>

      {(showCreate || editingCourseId) && (
        <Modal title={editingCourseId ? 'Edit course' : 'Course builder'} onClose={closeBuilder}>
          <CourseBuilder
            key={editingCourseId || 'new-course'}
            role={role}
            courseId={editingCourseId || undefined}
            notify={notify}
            onClose={closeBuilder}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ['courses-page'] })
              qc.invalidateQueries({ queryKey: ['courses'] })
            }}
          />
        </Modal>
      )}
    </>
  )
}

export function FormCreateCourse({ onSubmit, busy }) {
  return (
    <form
      className="modal-form"
      onSubmit={e => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        onSubmit({
          title: fd.get('title'),
          description: fd.get('description'),
          domainId: fd.get('domainId'),
          mandatory: fd.get('mandatory') === 'on',
        })
      }}
    >
      <label>
        Course title
        <input
          name="title"
          required
          maxLength="160"
          placeholder="e.g. Secure software fundamentals"
        />
      </label>

      <label>
        Domain ID
        <input
          name="domainId"
          required
          placeholder="24-character domain ID"
          minLength="24"
          maxLength="24"
        />
      </label>

      <label>
        Description
        <textarea
          name="description"
          rows="3"
          placeholder="What will learners be able to do?"
        />
      </label>

      <label className="check-label">
        <input type="checkbox" name="mandatory" /> Mandatory learning
      </label>

      <div className="modal-actions">
        <button
          className="button outline"
          type="button"
          onClick={e =>
            e.currentTarget
              .closest('.modal-backdrop')
              .querySelector('[aria-label="Close dialog"]')
              .click()
          }
        >
          Cancel
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create draft'}
        </button>
      </div>
    </form>
  )
}