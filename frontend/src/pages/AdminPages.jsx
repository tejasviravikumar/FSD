import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Award,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ClipboardCheck,
  Download,
  FileCheck2,
  Plus,
  Search,
  Users,
} from 'lucide-react'

import { api, unwrap } from '../api'
import { PasswordField } from '../components/PasswordField'
import { date, initials, messageOf, pretty, records, statusClass } from '../utils'
import {
  DataTable,
  EmptyState,
  ErrorNotice,
  Modal,
  PageHeading,
} from '../components/ui'
import { RuleBuilder } from './RuleBuilder'

export function PeoplePage({ notify }) {
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [courseId, setCourseId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [importResults, setImportResults] = useState(null)

  const query = useQuery({
    queryKey: ['people', search],
    queryFn: () =>
      api.get(
        `/users?page=1&limit=50&role=employee${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`,
      ),
  })

  const courseQuery = useQuery({
    queryKey: ['published-courses'],
    queryFn: () =>
      api.get('/courses?page=1&limit=100&status=published'),
    enabled: showAssign,
  })

  const users = records(unwrap(query.data))

  const create = useMutation({
    mutationFn: (data) => api.post('/users', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people'] })
      setShowCreate(false)
      notify({ message: 'Employee profile created' })
    },
    onError: (e) => notify({ message: messageOf(e), type: 'error' }),
  })

  const assign = useMutation({
    mutationFn: () =>
      api.post('/assignments', {
        courseId,
        employeeIds: users.map((user) => user._id),
        ...(dueDate
          ? { dueDate: new Date(dueDate).toISOString() }
          : {}),
      }),
    onSuccess: () => {
      setShowAssign(false)
      setCourseId('')
      setDueDate('')
      notify({
        message: `Course assigned to ${users.length} employees`,
      })
    },
    onError: (e) => notify({ message: messageOf(e), type: 'error' }),
  })

  const importCsv = async (file) => {
    const form = new FormData()
    form.append('file', file)

    try {
      const result = unwrap(await api.post('/users/import', form))
      setImportResults(result)
      qc.invalidateQueries({ queryKey: ['people'] })
      notify({ message: 'CSV import processed' })
    } catch (e) {
      notify({ message: messageOf(e), type: 'error' })
    }
  }

  const columns = [
    {
      key: 'name',
      label: 'Employee',
      render: (r) => (
        <span className="table-primary">
          <span className="user-avatar tiny">{initials(r.name)}</span>
          <span>
            <b>{r.name}</b>
            <small>{r.email}</small>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (r) => pretty(r.role),
    },
    {
      key: 'domain',
      label: 'Domain',
      render: (r) =>
        r.domainId?.name ||
        r.domain?.name ||
        r.domainName ||
        '--',
    },
    {
      key: 'location',
      label: 'Location',
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <span className={statusClass(r.status || 'active')}>
          {pretty(r.status || 'active')}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeading
        eyebrow="PEOPLE & ORGANIZATION"
        title="People"
        description="Manage employee profiles and keep learning assignments moving."
        action={
          <div className="heading-actions">
            <label className="button outline upload-button">
              <Download size={15} />
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) =>
                  e.target.files?.[0] &&
                  importCsv(e.target.files[0])
                }
              />
            </label>

            <button
              className="button outline"
              onClick={() => setShowAssign(true)}
              disabled={!users.length}
            >
              <BookOpen size={15} />
              Assign to results
            </button>

            <button
              className="button primary"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={16} />
              Add person
            </button>
          </div>
        }
      />

      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="Search name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <span className="muted">
          {users.length} employees in results
        </span>
      </div>

      {importResults && (
        <div className="import-summary">
          <Check size={16} />
          Import results received
          <button
            className="text-button"
            onClick={() => setImportResults(null)}
          >
            Dismiss
          </button>
          <pre>{JSON.stringify(importResults, null, 2)}</pre>
        </div>
      )}

      <ErrorNotice error={query.error} />

      <section className="panel table-panel">
        {query.isLoading ? (
          <div className="table-skeleton" />
        ) : users.length ? (
          <DataTable rows={users} columns={columns} />
        ) : (
          <EmptyState
            icon={Users}
            title="No people found"
            detail="Try another search or add a new employee."
          />
        )}
      </section>

      {showCreate && (
        <Modal
          title="Add a person"
          onClose={() => setShowCreate(false)}
        >
          <CreateUserForm
            busy={create.isPending}
            onSubmit={(data) => create.mutate(data)}
          />
        </Modal>
      )}

      {showAssign && (
        <Modal
          title="Assign course to employees"
          onClose={() => setShowAssign(false)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()
              assign.mutate()
            }}
          >
            <p className="muted">
              The course will be assigned to all {users.length}{' '}
              employees in the current result set.
            </p>

            <label>
              Published course
              <select
                required
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
              >
                <option value="">
                  Choose a published course
                </option>

                {records(unwrap(courseQuery.data)).map((course) => (
                  <option key={course._id} value={course._id}>
                    {course.courseCode
                      ? `${course.courseCode} · `
                      : ''}
                    {course.title}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Due date
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>

            <ErrorNotice error={courseQuery.error} />

            <div className="modal-actions">
              <button
                className="button primary"
                disabled={!courseId || assign.isPending}
              >
                {assign.isPending
                  ? 'Assigning...'
                  : `Assign to ${users.length} employees`}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

export function CreateUserForm({ busy, onSubmit }) {
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault()

        const f = new FormData(e.currentTarget)

        onSubmit({
          name: f.get('name'),
          email: f.get('email'),
          password: f.get('password'),
          role: f.get('role'),
          designation: f.get('designation'),
          level: f.get('level'),
          location: f.get('location'),
          domainId: f.get('domainId') || undefined,
        })
      }}
    >
      <label>
        Full name
        <input name="name" required maxLength="120" />
      </label>

      <label>
        Work email
        <input name="email" type="email" required />
      </label>

      <label>
        Temporary password
        <PasswordField
          name="password"
          minLength={10}
          required
          autoComplete="new-password"
        />
      </label>

      <div className="form-pair">
        <label>
          Role
          <select name="role">
            <option value="employee">Employee</option>
            <option value="trainer">Trainer</option>
            <option value="admin">Admin</option>
          </select>
        </label>

        <label>
          Level
          <input name="level" placeholder="e.g. L2" />
        </label>
      </div>

      <div className="form-pair">
        <label>
          Designation
          <input name="designation" />
        </label>

        <label>
          Location
          <input name="location" />
        </label>
      </div>

      <label>
        Domain ID
        <input
          name="domainId"
          minLength="24"
          maxLength="24"
          placeholder="Optional 24-character ID"
        />
      </label>

      <div className="modal-actions">
        <button
          className="button primary"
          disabled={busy}
        >
          {busy ? 'Saving...' : 'Create profile'}
        </button>
      </div>
    </form>
  )
}

export function DomainsPage({ notify }) {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.get('/domains'),
  })

  const [show, setShow] = useState(false)

  const create = useMutation({
    mutationFn: (data) => api.post('/domains', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['domains'] })
      setShow(false)
      notify({ message: 'Domain created' })
    },
    onError: (e) => notify({ message: messageOf(e), type: 'error' }),
  })

  const rows = records(unwrap(query.data))

  const columns = [
    {
      key: 'name',
      label: 'Domain',
      render: (r) => (
        <span className="table-primary">
          <span className="domain-avatar">
            {(r.name || '?').slice(0, 2).toUpperCase()}
          </span>

          <span>
            <b>{r.name}</b>
            <small>
              {r.description ||
                (r.isCommon
                  ? 'Shared across Nexora'
                  : 'Learning domain')}
            </small>
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (r) => (r.isCommon ? 'Common' : 'Business domain'),
    },
    {
      key: 'trainers',
      label: 'Trainers',
      render: (r) => (
        <TrainerDomainAssignment
          domain={r}
          notify={notify}
        />
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <span className={statusClass(r.status || 'active')}>
          {pretty(r.status || 'active')}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeading
        eyebrow="ORGANIZATION"
        title="Domains"
        description="Organize learning around teams, domains and trainers."
        action={
          <button
            className="button primary"
            onClick={() => setShow(true)}
          >
            <Plus size={16} />
            Add domain
          </button>
        }
      />

      <ErrorNotice error={query.error} />

      <section className="panel table-panel">
        {query.isLoading ? (
          <div className="table-skeleton" />
        ) : rows.length ? (
          <DataTable rows={rows} columns={columns} />
        ) : (
          <EmptyState
            icon={BriefcaseBusiness}
            title="No domains yet"
            detail="Add your first learning domain."
          />
        )}
      </section>

      {show && (
        <Modal
          title="Create a domain"
          onClose={() => setShow(false)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()

              const f = new FormData(e.currentTarget)

              create.mutate({
                name: f.get('name'),
                description: f.get('description'),
                isCommon: f.get('isCommon') === 'on',
              })
            }}
          >
            <label>
              Domain name
              <input
                name="name"
                maxLength="100"
                required
                placeholder="e.g. Finance"
              />
            </label>

            <label>
              Description
              <textarea name="description" rows="3" />
            </label>

            <label className="check-label">
              <input name="isCommon" type="checkbox" />
              Shared Common domain
            </label>

            <div className="modal-actions">
              <button
                className="button primary"
                disabled={create.isPending}
              >
                Create domain
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

function TrainerDomainAssignment({ domain, notify }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [saving, setSaving] = useState(false)

  const query = useQuery({
    queryKey: ['domain-trainers', domain._id],
    queryFn: () =>
      api.get('/users?page=1&limit=100&role=trainer'),
    enabled: open,
  })

  const trainers = records(unwrap(query.data))

  useEffect(() => {
    if (open && query.isSuccess) {
      setSelected(
        trainers
          .filter((t) =>
            (t.trainerDomains || []).some(
              (d) =>
                String(d?._id || d) === String(domain._id),
            ),
          )
          .map((t) => t._id),
      )
    }
  }, [open, query.isSuccess, domain._id, query.data])

  const toggle = (id) => {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id],
    )
  }

  const save = async () => {
    setSaving(true)

    try {
      await api.put(`/domains/${domain._id}/trainers`, {
        trainerIds: selected,
      })

      notify({ message: 'Domain trainers updated' })
      setOpen(false)
    } catch (e) {
      notify({ message: messageOf(e), type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        className="mini-button"
        onClick={() => setOpen(true)}
      >
        Manage trainers
      </button>

      {open && (
        <Modal
          title={`Trainers for ${domain.name}`}
          onClose={() => setOpen(false)}
        >
          <p className="muted">
            Choose which trainers can create and manage courses
            for this domain.
          </p>

          {query.isLoading ? (
            <div className="table-skeleton" />
          ) : (
            trainers.map((t) => (
              <label
                className="trainer-choice"
                key={t._id}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(t._id)}
                  onChange={() => toggle(t._id)}
                />

                <span className="user-avatar tiny">
                  {initials(t.name)}
                </span>

                <span>
                  <b>{t.name}</b>
                  <small>{t.email}</small>
                </span>
              </label>
            ))
          )}

          <ErrorNotice error={query.error} />

          <div className="modal-actions">
            <button
              className="button primary"
              disabled={saving || query.isLoading}
              onClick={save}
            >
              {saving ? 'Saving...' : 'Save trainers'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

export function RulesPage({ notify }) {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['rules'],
    queryFn: () => api.get('/rules'),
  })

  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null)
  const [creating, setCreating] = useState(false)

  const run = useMutation({
    mutationFn: () => api.post('/rules/run'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] })
      notify({ message: 'Assignment rules evaluated' })
    },
    onError: (e) =>
      notify({ message: messageOf(e), type: 'error' }),
  })

  const activate = useMutation({
    mutationFn: (rule) =>
      api.patch(`/rules/${rule._id}`, {
        isActive: !rule.isActive,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] })
      notify({ message: 'Rule status updated' })
    },
    onError: (e) =>
      notify({ message: messageOf(e), type: 'error' }),
  })

  const previewRule = async (rule) => {
    setSelected(rule)
    setPreview(null)

    try {
      setPreview(
        unwrap(await api.post(`/rules/${rule._id}/preview`)),
      )
    } catch (e) {
      notify({ message: messageOf(e), type: 'error' })
    }
  }

  const rows = records(unwrap(query.data))

  const columns = [
    {
      key: 'name',
      label: 'Rule',
      render: (r) => (
        <span className="table-primary">
          <span className="table-icon">
            <ClipboardCheck size={16} />
          </span>

          <span>
            <b>
              {r.name ||
                r.course?.title ||
                'Assignment rule'}
            </b>
            <small>
              {r.courseId?.title ||
                r.course?.title ||
                r.courseTitle ||
                'Linked course'}
            </small>
          </span>
        </span>
      ),
    },
    {
      key: 'domain',
      label: 'Domain',
      render: (r) =>
        r.courseId?.domainId?.name ||
        r.domain?.name ||
        r.domainName ||
        '--',
    },
    {
      key: 'recurrence',
      label: 'Recurrence',
      render: (r) => ruleRecurrence(r.recurrence),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <span
          className={statusClass(
            r.status ||
              (r.isActive ? 'active' : 'inactive'),
          )}
        >
          {pretty(
            r.status ||
              (r.isActive ? 'active' : 'inactive'),
          )}
        </span>
      ),
    },
    {
      key: 'action',
      label: '',
      render: (r) => (
        <span className="rule-actions">
          <button
            className="mini-button"
            onClick={() => previewRule(r)}
          >
            Preview matches
          </button>

          <button
            className="mini-button"
            disabled={activate.isPending}
            onClick={() => activate.mutate(r)}
          >
            {r.isActive ? 'Pause' : 'Activate'}
          </button>
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeading
        eyebrow="AUTOMATION"
        title="Assignment rules"
        description="Match learning to people automatically with consistent, repeatable criteria."
        action={
          <div className="heading-actions">
            <button
              className="button outline"
              onClick={() => setCreating(true)}
            >
              <Plus size={15} />
              New rule
            </button>

            <button
              className="button primary"
              onClick={() => run.mutate()}
              disabled={run.isPending}
            >
              <Activity size={15} />
              {run.isPending ? 'Running...' : 'Run rules'}
            </button>
          </div>
        }
      />

      <ErrorNotice error={query.error} />

      <section className="panel table-panel">
        {query.isLoading ? (
          <div className="table-skeleton" />
        ) : rows.length ? (
          <DataTable rows={rows} columns={columns} />
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="No assignment rules yet"
            detail="Create a rule from the API or start by assigning a course to a team."
          />
        )}
      </section>

      {creating && (
        <Modal
          title="Build an assignment rule"
          onClose={() => setCreating(false)}
        >
          <RuleBuilder
            notify={notify}
            onClose={() => setCreating(false)}
            onSaved={() =>
              qc.invalidateQueries({
                queryKey: ['rules'],
              })
            }
          />
        </Modal>
      )}

      {selected && (
        <Modal
          title="Rule match preview"
          onClose={() => {
            setSelected(null)
            setPreview(null)
          }}
        >
          <div className="preview-box">
            <span className="preview-count">
              {records(preview).length ||
                preview?.count ||
                preview?.matchCount ||
                0}
            </span>

            <h3>Employees match this rule</h3>

            <p>
              {selected.name ||
                selected.course?.title ||
                'Selected assignment rule'}
            </p>
          </div>

          {records(preview)
            .slice(0, 8)
            .map((x) => (
              <div className="simple-row" key={x._id}>
                <b>{x.name}</b>
                <span>{x.email}</span>
              </div>
            ))}
        </Modal>
      )}
    </>
  )
}

export function ApprovalsPage({ notify }) {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['approval-courses'],
    queryFn: () =>
      api.get(
        '/courses?page=1&limit=100&status=under_review',
      ),
  })

  const [rejecting, setRejecting] = useState(null)
  const [reviewing, setReviewing] = useState(null)
  const [notes, setNotes] = useState('')

  const assessmentQuery = useQuery({
    queryKey: ['approval-assessment', reviewing?._id],
    queryFn: () =>
      api.get(`/courses/${reviewing._id}/assessment`),
    enabled: Boolean(reviewing),
    retry: false,
  })

  const act = useMutation({
    mutationFn: ({ id, type, notes }) =>
      api.post(
        `/courses/${id}/${type}`,
        type === 'reject' ? { notes } : {},
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({
        queryKey: ['approval-courses'],
      })
      qc.invalidateQueries({ queryKey: ['courses'] })

      notify({
        message:
          vars.type === 'approve'
            ? 'Course approved and published'
            : 'Course returned to trainer',
      })

      setRejecting(null)
      setNotes('')
    },
    onError: (e) =>
      notify({ message: messageOf(e), type: 'error' }),
  })

  const rows = records(unwrap(query.data))

  return (
    <>
      <PageHeading
        eyebrow="CONTENT GOVERNANCE"
        title="Approvals"
        description="Review trainer course submissions before publishing."
      />

      <ErrorNotice error={query.error} />

      <section className="approval-section">
        <h2>Course submissions</h2>

        {rows.length ? (
          <div className="approval-grid">
            {rows.map((course) => (
              <article
                className="panel approval-card"
                key={course._id}
              >
                <div className="approval-top">
                  <div className="course-symbol">
                    <BookOpen size={19} />
                  </div>

                  <span
                    className={statusClass(course.status)}
                  >
                    {pretty(course.status)}
                  </span>
                </div>

                <div className="eyebrow small-eyebrow">
                  {course.domainId?.name ||
                    course.domain?.name ||
                    course.domainName ||
                    'Nexora Learning'}
                </div>

                <h2>{course.title}</h2>

                {course.courseCode && (
                  <small className="muted">
                    Course code: {course.courseCode}
                  </small>
                )}

                <p>
                  {course.description ||
                    'No course description was provided.'}
                </p>

                <div className="approval-meta">
                  <span>
                    Submitted by{' '}
                    {course.trainerId?.name ||
                      course.trainer?.name ||
                      course.owner?.name ||
                      'Course trainer'}
                    {course.trainerId?.email
                      ? ` (${course.trainerId.email})`
                      : ''}
                  </span>

                  <span>
                    {course.modules?.length ??
                      course.moduleCount ??
                      0}{' '}
                    modules
                  </span>
                </div>

                <div className="approval-buttons">
                  <button
                    className="button outline"
                    onClick={() => setReviewing(course)}
                  >
                    Review content
                  </button>

                  <button
                    className="button outline"
                    onClick={() => {
                      setRejecting(course)
                      setNotes('')
                    }}
                  >
                    Request changes
                  </button>

                  <button
                    className="button primary"
                    disabled={act.isPending}
                    onClick={() =>
                      act.mutate({
                        id: course._id,
                        type: 'approve',
                      })
                    }
                  >
                    <Check size={15} />
                    Approve
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <section className="panel">
            <EmptyState
              icon={FileCheck2}
              title="No course submissions"
              detail="Courses submitted for review will appear here."
            />
          </section>
        )}
      </section>

      {reviewing && (
        <Modal
          title={`Review: ${reviewing.title}`}
          onClose={() => setReviewing(null)}
        >
          <CourseReviewPreview
            course={reviewing}
            assessmentQuery={assessmentQuery}
            notify={notify}
          />
        </Modal>
      )}

      {rejecting && (
        <Modal
          title="Request changes"
          onClose={() => setRejecting(null)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()

              if (notes.trim()) {
                act.mutate({
                  id: rejecting._id,
                  type: 'reject',
                  notes,
                })
              }
            }}
          >
            <p className="muted">
              Share clear feedback with the trainer about
              &quot;{rejecting.title}&quot;.
            </p>

            <label>
              Review notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                required
                minLength="1"
                maxLength="1000"
                rows="4"
              />
            </label>

            <div className="modal-actions">
              <button
                className="button primary"
                disabled={act.isPending || !notes.trim()}
              >
                Send feedback
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

function CourseReviewPreview({
  course,
  assessmentQuery,
  notify,
}) {
  const questions =
    unwrap(assessmentQuery.data)?.questions || []

  return (
    <div className="builder-stage">
      <p>
        {course.description ||
          'No course description was provided.'}
      </p>

      <h3>Course modules</h3>

      {(course.modules || []).map((module, index) => (
        <section
          className="panel assessment-question"
          key={module._id || index}
        >
          <b>
            {index + 1}. {module.title}
          </b>

          <p className="muted">
            {pretty(module.type)}
            {module.isRequired !== false
              ? ' · Required'
              : ''}
          </p>

          {module.notes && <p>{module.notes}</p>}

          {module.sourceUrl && (
            <p>
              <a
                href={module.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open lesson link
              </a>
            </p>
          )}

          {module.youtubeVideoId && (
            <>
              <div className="approval-video">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(
                    module.youtubeVideoId,
                  )}`}
                  title={`YouTube video: ${module.title}`}
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>

              <p>
                <a
                  href={`https://www.youtube.com/watch?v=${encodeURIComponent(
                    module.youtubeVideoId,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open video on YouTube
                </a>
              </p>
            </>
          )}

          {module.uploadId && (
            <button
              className="button outline"
              onClick={() =>
                api
                  .download(
                    `/uploads/${module.uploadId}`,
                    `${module.title}.pdf`,
                  )
                  .catch((e) =>
                    notify({
                      message: messageOf(e),
                      type: 'error',
                    }),
                  )
              }
            >
              Download PDF lesson
            </button>
          )}
        </section>
      ))}

      <h3>Assessment</h3>

      {assessmentQuery.isLoading ? (
        <p>Loading assessment...</p>
      ) : assessmentQuery.error ? (
        <ErrorNotice error={assessmentQuery.error} />
      ) : (
        questions.map((question, index) => (
          <section
            className="panel assessment-question"
            key={question._id || index}
          >
            <b>
              Question {index + 1}: {question.text}
            </b>

            <p className="muted">
              {pretty(question.type || 'single_choice')}
            </p>

            <ul>
              {question.options?.map(
                (option, optionIndex) => (
                  <li
                    className={
                      option.isCorrect
                        ? 'approval-correct-answer'
                        : undefined
                    }
                    key={option._id || optionIndex}
                  >
                    {option.text}

                    {option.isCorrect && (
                      <strong className="approval-answer-label">
                        Correct answer
                      </strong>
                    )}
                  </li>
                ),
              )}
            </ul>

            {question.explanation && (
              <p>{question.explanation}</p>
            )}
          </section>
        ))
      )}
    </div>
  )
}

export function CertificateReviewPage({ notify }) {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['certificate-verification'],
    queryFn: () =>
      api.get(
        '/certificates?page=1&limit=100&status=pending_verification',
      ),
  })

  const rows = records(unwrap(query.data))

  const verify = useMutation({
    mutationFn: (id) =>
      api.patch(`/certificates/${id}/verify`, {}),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['certificate-verification'],
      })
      qc.invalidateQueries({
        queryKey: ['issued-certificates'],
      })

      notify({ message: 'Certificate verified' })
    },
    onError: (e) =>
      notify({ message: messageOf(e), type: 'error' }),
  })

  return (
    <>
      <PageHeading
        eyebrow="CERTIFICATE GOVERNANCE"
        title="Certificate verification"
        description="Review employee certificate uploads and verify pending submissions."
      />

      <ErrorNotice error={query.error} />

      {rows.length ? (
        <div className="approval-grid">
          {rows.map((cert) => (
            <article
              className="panel approval-card"
              key={cert._id}
            >
              <div className="approval-top">
                <div className="course-symbol">
                  <FileCheck2 size={19} />
                </div>

                <span className={statusClass(cert.status)}>
                  {pretty(cert.status)}
                </span>
              </div>

              <div className="eyebrow small-eyebrow">
                {cert.employeeId?.designation ||
                  'Employee certificate'}
              </div>

              <h2>
                {cert.courseId?.title ||
                  cert.title ||
                  'Certificate upload'}
              </h2>

              <p>
                Submitted by{' '}
                {cert.employeeId?.name || 'Employee'}
                {cert.employeeId?.email
                  ? ` · ${cert.employeeId.email}`
                  : ''}
              </p>

              <div className="approval-meta">
                <span>Issued {date(cert.issueDate)}</span>
                <span>Expires {date(cert.expiryDate)}</span>
              </div>

              <div className="approval-buttons">
                {cert.uploadId && (
                  <button
                    className="button outline"
                    onClick={() =>
                      api
                        .download(
                          `/certificates/${cert._id}/file`,
                          cert.uploadId.originalName ||
                            'certificate-upload',
                        )
                        .catch((e) =>
                          notify({
                            message: messageOf(e),
                            type: 'error',
                          }),
                        )
                    }
                  >
                    <Download size={15} />
                    View file
                  </button>
                )}

                <button
                  className="button primary"
                  disabled={verify.isPending}
                  onClick={() => verify.mutate(cert._id)}
                >
                  <Check size={15} />
                  Verify
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <EmptyState
            icon={FileCheck2}
            title="No certificates awaiting review"
            detail="Pending employee uploads will appear here."
          />
        </section>
      )}
    </>
  )
}

export function IssuedCertificatesPage({ notify }) {
  const query = useQuery({
    queryKey: ['issued-certificates'],
    queryFn: () =>
      api.get('/certificates?page=1&limit=100'),
  })

  const rows = records(unwrap(query.data)).filter(
    (cert) => cert.status !== 'pending_verification',
  )

  const columns = [
    {
      key: 'employee',
      label: 'Employee',
      render: (cert) =>
        cert.employeeId?.name || 'Employee',
    },
    {
      key: 'course',
      label: 'Course',
      render: (cert) =>
        cert.courseId?.title ||
        cert.title ||
        'Certificate',
    },
    {
      key: 'certificateNumber',
      label: 'Certificate number',
      render: (cert) =>
        cert.certificateNumber || '—',
    },
    {
      key: 'status',
      label: 'Status',
      render: (cert) => (
        <span className={statusClass(cert.status)}>
          {pretty(cert.status)}
        </span>
      ),
    },
    {
      key: 'issueDate',
      label: 'Issued',
      render: (cert) => date(cert.issueDate),
    },
    {
      key: 'expiryDate',
      label: 'Expires',
      render: (cert) => date(cert.expiryDate),
    },
    {
      key: 'file',
      label: '',
      render: (cert) => (
        <button
          className="mini-button"
          onClick={() =>
            api
              .download(
                `/certificates/${cert._id}/file`,
                cert.uploadId?.originalName ||
                  `${cert.certificateNumber || 'certificate'}.pdf`,
              )
              .catch((e) =>
                notify({
                  message: messageOf(e),
                  type: 'error',
                }),
              )
          }
        >
          <Download size={14} />
          Download
        </button>
      ),
    },
  ]

  return (
    <>
      <PageHeading
        eyebrow="CERTIFICATE GOVERNANCE"
        title="Issued certificates"
        description="Browse certificates issued to employees and check their current status."
      />

      <ErrorNotice error={query.error} />

      <section className="panel table-panel">
        {query.isLoading ? (
          <div className="table-skeleton" />
        ) : rows.length ? (
          <DataTable rows={rows} columns={columns} />
        ) : (
          <EmptyState
            icon={Award}
            title="No issued certificates"
            detail="Verified employee uploads and course certificates will appear here."
          />
        )}
      </section>
    </>
  )
}

function ruleRecurrence(value) {
  if (!value) return 'One-time'

  if (typeof value === 'string') {
    return pretty(value)
  }

  return value.type === 'custom'
    ? `Every ${value.months} months`
    : pretty(value.type || 'One-time')
}