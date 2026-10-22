import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  Bell,
  Check,
  Download,
  FileCheck2,
  FilePlus2,
  Filter,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { api, unwrap } from '../api'
import { date, initials, messageOf, pretty, records, statusClass } from '../utils'
import { DataTable, EmptyState, ErrorNotice, PageHeading } from '../components/ui'
import { JobsPanel } from './JobsPanel'

const OBJECT_ID = /^[a-f\d]{24}$/i

const REPORT_OPTIONS = [
  ['compliance', 'Compliance'],
  ['completion', 'Completion'],
  ['expiry-forecast', 'Expiry forecast'],
  ['overdue', 'Overdue'],
  ['trainer', 'Course trainer analytics'],
  ['assessment-quality', 'Assessment quality'],
]

const AUDIT_ENTITY_TYPES = [
  'User',
  'Course',
  'Settings',
  'Assignment',
  'Job',
  'Domain',
  'Certificate',
]

const courseOptionLabel = course => `${course.courseCode ? `${course.courseCode} · ` : ''}${course.title}`

// =============================================================================
// Reports
// =============================================================================
export function ReportsPage({ role, user }) {
  const [report, setReport] = useState('compliance')
  const [months, setMonths] = useState(3)
  const [courseId, setCourseId] = useState('')

  const courseReport = ['trainer', 'assessment-quality'].includes(report)
  const validCourseId = OBJECT_ID.test(courseId)

  const coursesQuery = useQuery({
    queryKey: ['report-courses', role],
    queryFn: () => api.get('/courses?page=1&limit=100'),
    enabled: courseReport,
  })

  const endpoint = courseReport
    ? `/reports/${report}/${courseId}`
    : `/reports/${report}${report === 'expiry-forecast' ? `?months=${months}` : ''}`

  const query = useQuery({
    queryKey: ['report', report, months, courseId],
    queryFn: () => api.get(endpoint),
    enabled: !courseReport || validCourseId,
  })

  const allCourses = records(unwrap(coursesQuery.data))
  const courses =
    role === 'trainer' && user?._id
      ? allCourses.filter(
          course => String(course.trainerId?._id || course.trainerId) === String(user._id),
        )
      : allCourses

  const rows = records(unwrap(query.data))
  const columns = rows.length
    ? Object.keys(rows[0])
        .filter(k => !['__v'].includes(k))
        .slice(0, 7)
        .map(key => ({
          key,
          label: pretty(key),
          render: row =>
            key.toLowerCase().includes('date')
              ? date(row[key])
              : typeof row[key] === 'object'
                ? row[key]?.name || row[key]?.title || '—'
                : pretty(String(row[key] ?? '—')),
        }))
    : []

  const scopeLabel = role === 'admin' ? 'organization' : role === 'trainer' ? 'courses' : 'team'

  return (
    <>
      <PageHeading
        eyebrow="INSIGHTS & COMPLIANCE"
        title="Reports"
        description={`Scoped reporting for your ${scopeLabel}.`}
      />

      <div className="report-controls">
        <label>
          Report
          <select
            value={report}
            onChange={e => {
              setReport(e.target.value)
              setCourseId('')
            }}
          >
            {REPORT_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>

        {report === 'expiry-forecast' && (
          <label>
            Forecast window
            <select value={months} onChange={e => setMonths(Number(e.target.value))}>
              {[1, 3, 6, 12].map(m => (
                <option key={m} value={m}>
                  {m} months
                </option>
              ))}
            </select>
          </label>
        )}

        {courseReport && (
          <label>
            Course
            <select value={courseId} onChange={e => setCourseId(e.target.value)}>
              <option value="">Choose a course</option>
              {courses.map(course => (
                <option key={course._id} value={course._id}>
                  {courseOptionLabel(course)} · {course.status}
                </option>
              ))}
            </select>
            {coursesQuery.error && <small className="field-error">Could not load courses.</small>}
          </label>
        )}

        <button
          className="button outline"
          disabled={courseReport && !validCourseId}
          onClick={() =>
            api
              .download(
                `${endpoint}${endpoint.includes('?') ? '&' : '?'}format=csv`,
                `${report}.csv`,
              )
              .catch(() => {})
          }
        >
          <Download size={15} /> Export CSV
        </button>
      </div>

      <ErrorNotice error={coursesQuery.error || query.error} />

      <section className="panel table-panel">
        {query.isLoading ? (
          <div className="table-skeleton" />
        ) : rows.length ? (
          <DataTable rows={rows} columns={columns} />
        ) : (
          <EmptyState
            icon={Activity}
            title="No report data"
            detail={
              courseReport && !courseId
                ? 'Choose a course to load its report.'
                : 'There are no rows for these report filters yet.'
            }
          />
        )}
      </section>
    </>
  )
}

// =============================================================================
// Audit log
// =============================================================================
export function AuditPage() {
  const [entityType, setEntityType] = useState('')
  const [action, setAction] = useState('')
  const [actorId, setActorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const usersQuery = useQuery({
    queryKey: ['audit-users'],
    queryFn: () => api.get('/users?page=1&limit=100'),
  })

  const queryString = new URLSearchParams({
    page: '1',
    limit: '50',
    ...(entityType ? { entityType } : {}),
    ...(action ? { action } : {}),
    ...(actorId ? { actorId } : {}),
    ...(from ? { from: `${from}T00:00:00.000Z` } : {}),
    ...(to ? { to: `${to}T23:59:59.999Z` } : {}),
  }).toString()

  const query = useQuery({
    queryKey: ['audit', entityType, action, actorId, from, to],
    queryFn: () => api.get(`/audit-logs?${queryString}`),
  })

  const rows = records(unwrap(query.data))
  const users = records(unwrap(usersQuery.data))

  const columns = [
    { key: 'createdAt', label: 'Time', render: r => date(r.createdAt) },
    {
      key: 'actor',
      label: 'Performed by',
      render: r =>
        r.actor?.name ? (
          <span title={r.actor.email || ''}>{r.actor.name}</span>
        ) : r.actorId ? (
          'Former user'
        ) : (
          'Automated system'
        ),
    },
    {
      key: 'action',
      label: 'Action',
      render: r => <span className="audit-action">{pretty(r.action)}</span>,
    },
    { key: 'entityType', label: 'Record type' },
    {
      key: 'entityId',
      label: 'Reference',
      render: r =>
        r.entityId ? <code title={String(r.entityId)}>{String(r.entityId).slice(0, 8)}...</code> : '--',
    },
    {
      key: 'after',
      label: 'Details',
      render: r => (r.after ? JSON.stringify(r.after).slice(0, 100) : '--'),
    },
  ]

  return (
    <>
      <PageHeading
        eyebrow="SECURITY & GOVERNANCE"
        title="Audit log"
        description="See who performed each action and what record it affected."
      />

      <div className="toolbar">
        <label className="select-wrap">
          <Filter size={15} />
          <select value={entityType} onChange={e => setEntityType(e.target.value)}>
            <option value="">All record types</option>
            {AUDIT_ENTITY_TYPES.map(x => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>

        <div className="search-box">
          <Search size={15} />
          <input
            placeholder="Filter by action"
            value={action}
            onChange={e => setAction(e.target.value)}
          />
        </div>

        <label className="select-wrap">
          <Users size={15} />
          <select value={actorId} onChange={e => setActorId(e.target.value)}>
            <option value="">Anyone</option>
            {users.map(user => (
              <option key={user._id} value={user._id}>
                {user.name} ({user.email})
              </option>
            ))}
          </select>
        </label>

        <label className="date-filter">
          From
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className="date-filter">
          To
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </label>
      </div>

      <ErrorNotice error={usersQuery.error || query.error} />

      <section className="panel table-panel">
        {query.isLoading ? (
          <div className="table-skeleton" />
        ) : rows.length ? (
          <DataTable rows={rows} columns={columns} />
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="No matching audit events"
            detail="Events will appear as actions are recorded."
          />
        )}
      </section>
    </>
  )
}

// =============================================================================
// Settings
// =============================================================================
export function SettingsPage({ notify }) {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') })
  const settings = unwrap(query.data) || {}
  const [form, setForm] = useState(null)

  useEffect(() => {
    if (query.isSuccess && settings && !form) {
      setForm({
        reminderThresholds: (settings.reminderThresholds || [90, 60, 30, 7, 0]).join(', '),
        certificateExpiringSoonDays: settings.certificateExpiringSoonDays ?? 60,
        certificateRenewalDays: settings.certificateRenewalDays ?? 60,
        lockoutFailures: settings.lockoutFailures ?? 5,
        lockoutMinutes: settings.lockoutMinutes ?? 15,
      })
    }
  }, [query.isSuccess, settings, form])

  const save = useMutation({
    mutationFn: payload => api.patch('/settings', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      notify({ message: 'Settings saved' })
    },
    onError: e => notify({ message: messageOf(e), type: 'error' }),
  })

  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }))

  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE CONFIGURATION"
        title="Settings"
        description="Tune reminders, certificate windows and account lockout behavior."
      />

      <ErrorNotice error={query.error} />

      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="settings-icon">
            <Bell size={18} />
          </div>
          <h2>Learning reminders</h2>
          <p>Set the days before a due date or certificate expiry when reminders are sent.</p>

          <label>
            Reminder thresholds (days)
            <input
              value={form?.reminderThresholds ?? ''}
              onChange={e => update('reminderThresholds', e.target.value)}
              placeholder="90, 60, 30, 7, 0"
            />
          </label>
          <div className="field-hint">
            Separate each number with a comma. Include 0 for due day.
          </div>

          <label>
            Expiring soon window
            <input
              type="number"
              min="1"
              max="365"
              value={form?.certificateExpiringSoonDays ?? ''}
              onChange={e => update('certificateExpiringSoonDays', Number(e.target.value))}
            />
          </label>

          <label>
            Renewal assignment lead time
            <input
              type="number"
              min="1"
              max="365"
              value={form?.certificateRenewalDays ?? ''}
              onChange={e => update('certificateRenewalDays', Number(e.target.value))}
            />
          </label>
        </section>

        <section className="panel settings-card">
          <div className="settings-icon security">
            <ShieldCheck size={18} />
          </div>
          <h2>Account protection</h2>
          <p>Control failed sign-in lockout limits and recovery timing.</p>

          <label>
            Failed attempts before lockout
            <input
              type="number"
              min="3"
              max="20"
              value={form?.lockoutFailures ?? ''}
              onChange={e => update('lockoutFailures', Number(e.target.value))}
            />
          </label>

          <label>
            Initial lockout duration (minutes)
            <input
              type="number"
              min="1"
              max="1440"
              value={form?.lockoutMinutes ?? ''}
              onChange={e => update('lockoutMinutes', Number(e.target.value))}
            />
          </label>

          <div className="settings-foot">
            <span>Changes are recorded in the audit log.</span>
            <button
              className="button primary"
              disabled={!form || save.isPending}
              onClick={() =>
                save.mutate({
                  ...form,
                  reminderThresholds: String(form.reminderThresholds)
                    .split(',')
                    .map(x => Number(x.trim()))
                    .filter(Number.isFinite),
                })
              }
            >
              {save.isPending ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </section>
      </div>

      <JobsPanel notify={notify} />
    </>
  )
}

// =============================================================================
// Notifications
// =============================================================================
export function NotificationsPage({ notify }) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['notifications-full'],
    queryFn: () => api.get('/notifications?page=1&limit=100'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const rows = records(unwrap(query.data))

  const refreshNotifications = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] })
    qc.invalidateQueries({ queryKey: ['notifications-full'] })
  }

  const mark = async id => {
    try {
      await api.patch(`/notifications/${id}/read`, {})
      refreshNotifications()
    } catch (e) {
      notify({ message: messageOf(e), type: 'error' })
    }
  }

  const markAll = async () => {
    try {
      await api.patch('/notifications/read-all', {})
      refreshNotifications()
      notify({ message: 'All notifications marked as read' })
    } catch (e) {
      notify({ message: messageOf(e), type: 'error' })
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="YOUR UPDATES"
        title="Notifications"
        description="Learning assignments, reminders and account updates in one place."
        action={
          rows.some(n => !n.readAt) && (
            <button className="button outline" onClick={markAll}>
              <Check size={15} /> Mark all as read
            </button>
          )
        }
      />

      <ErrorNotice error={query.error} />

      <div className="notification-list">
        {query.isLoading ? (
          <div className="panel table-skeleton" />
        ) : rows.length ? (
          rows.map(n => (
            <article
              className={`panel notification-item ${!n.readAt ? 'unread' : ''}`}
              key={n._id}
            >
              <span className="notification-icon">
                <Bell size={17} />
              </span>
              <div className="grow">
                <div className="notification-heading">
                  <b>{n.title}</b>
                  {!n.readAt && <i />}
                </div>
                <p>{n.message}</p>
                <small>
                  {date(n.createdAt)} | {pretty(n.type || 'update')}
                </small>
              </div>
              {!n.readAt && (
                <button className="mini-button" onClick={() => mark(n._id)}>
                  Mark read
                </button>
              )}
            </article>
          ))
        ) : (
          <section className="panel">
            <EmptyState
              icon={Bell}
              title="No notifications yet"
              detail="Assignments, reminders, and course updates will appear here."
            />
          </section>
        )}
      </div>
    </>
  )
}

// =============================================================================
// My certificates
// =============================================================================
export function CertificatesPage({ notify }) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['certificates-full'],
    queryFn: () => api.get('/certificates/me'),
  })
  const coursesQuery = useQuery({
    queryKey: ['certificate-courses'],
    queryFn: () => api.get('/courses?page=1&limit=100'),
  })
  const [courseId, setCourseId] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const formRef = useRef(null)

  // One certificate per course: internal first, then most recently issued
  const rows = [
    ...new Map(
      records(unwrap(query.data))
        .filter(c => c.status !== 'pending_verification')
        .sort(
          (a, b) =>
            Number(b.source === 'internal') - Number(a.source === 'internal') ||
            new Date(b.issueDate || 0) - new Date(a.issueDate || 0),
        )
        .map(c => {
          const courseTitle =
            c.courseId?.title ||
            c.course?.title ||
            c.title ||
            c.courseTitle ||
            c.certificateNumber ||
            'Certificate'
          return [String(courseTitle).trim().toLowerCase(), c]
        }),
    ).values(),
  ]

  const upload = async e => {
    e.preventDefault()
    if (!file || !courseId || uploading) return

    const fd = new FormData()
    fd.append('courseId', courseId)
    fd.append('file', file)

    setUploading(true)
    try {
      await api.post('/certificates', fd)
      setFile(null)
      setCourseId('')
      formRef.current?.reset()
      qc.invalidateQueries({ queryKey: ['certificates-full'] })
      notify({ message: 'Certificate submitted for verification' })
    } catch (err) {
      notify({ message: messageOf(err), type: 'error' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="CREDENTIALS"
        title="My certificates"
        description="Keep track of your achievements, validity and renewals."
      />

      <div className="certificate-grid">
        {rows.map(c => (
          <article className="panel certificate-card" key={c._id}>
            <div className="certificate-top">
              <span className="cert-large-icon">
                <FileCheck2 size={21} />
              </span>
              <span className={statusClass(c.status)}>{pretty(c.status || 'valid')}</span>
            </div>

            <div className="eyebrow small-eyebrow">NEXORA CERTIFICATION</div>
            <h2>
              {c.courseId?.title || c.course?.title || c.title || c.courseTitle || 'External certificate'}
            </h2>
            <p>{c.certificateNumber || 'Certificate pending verification'}</p>

            <div className="certificate-detail">
              <span>Issued {date(c.issueDate || c.issuedAt)}</span>
              <span>Expires {date(c.expiryDate || c.validUntil)}</span>
            </div>

            {c._id &&
              c.status !== 'pending_verification' &&
              (c.uploadId || c.source === 'internal') && (
                <button
                  className="button outline full"
                  onClick={() =>
                    api
                      .download(
                        `/certificates/${c._id}/file`,
                        c.uploadId?.originalName || `${c.certificateNumber || 'nexora-certificate'}.pdf`,
                      )
                      .catch(e => notify({ message: messageOf(e), type: 'error' }))
                  }
                >
                  <Download size={15} /> Download certificate file
                </button>
              )}
          </article>
        ))}

        {!rows.length && (
          <section className="panel certificate-empty">
            <EmptyState
              icon={FileCheck2}
              title="Your achievements start here"
              detail="Certificates earned from completed courses and verified uploads will appear here."
            />
          </section>
        )}
      </div>

      <section className="panel upload-card">
        <div className="upload-heading">
          <span className="cert-large-icon">
            <FilePlus2 size={20} />
          </span>
          <div>
            <h2>Upload an external certificate</h2>
            <p>Submit a PDF, JPG or PNG certificate for verification.</p>
          </div>
        </div>

        <form ref={formRef} className="upload-form" onSubmit={upload}>
          <label>
            Course
            <select value={courseId} onChange={e => setCourseId(e.target.value)} required>
              <option value="">Choose a course</option>
              {records(unwrap(coursesQuery.data)).map(course => (
                <option key={course._id} value={course._id}>
                  {courseOptionLabel(course)}
                </option>
              ))}
            </select>
          </label>

          {coursesQuery.error && <ErrorNotice error={coursesQuery.error} />}

          <label className="drop-zone">
            <Download size={19} />
            <b>{file?.name || 'Choose a certificate file'}</b>
            <span>PDF, JPEG or PNG</span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={e => setFile(e.target.files?.[0] || null)}
              required
            />
          </label>

          <button className="button primary" disabled={!file || !courseId || uploading}>
            {uploading ? 'Submitting...' : 'Submit for verification'} <ArrowRight size={15} />
          </button>
        </form>
      </section>
    </>
  )
}

// =============================================================================
// Certificate status (trainer / employee)
// =============================================================================
export function TrainerCertificateStatusPage({ role, notify }) {
  const isEmployee = role === 'employee'

  const query = useQuery({
    queryKey: ['certificate-status', role],
    queryFn: () =>
      api.get(isEmployee ? '/certificates/me' : '/certificates?page=1&limit=100'),
  })
  const rows = records(unwrap(query.data)).filter(cert => cert.uploadId)

  const columns = [
    ...(!isEmployee
      ? [
          {
            key: 'employee',
            label: 'Employee',
            render: cert => cert.employeeId?.name || 'Employee',
          },
        ]
      : []),
    {
      key: 'course',
      label: 'Course',
      render: cert => cert.courseId?.title || cert.title || 'Certificate',
    },
    {
      key: 'status',
      label: 'Status',
      render: cert => <span className={statusClass(cert.status)}>{pretty(cert.status)}</span>,
    },
    {
      key: 'file',
      label: '',
      render: cert =>
        cert.uploadId && (
          <button
            className="button outline certificate-status-file-button"
            onClick={() =>
              api
                .download(
                  `/certificates/${cert._id}/file`,
                  cert.uploadId.originalName || 'course-certificate',
                )
                .catch(e => notify({ message: messageOf(e), type: 'error' }))
            }
          >
            <Download size={16} /> View uploaded file
          </button>
        ),
    },
  ]

  return (
    <>
      <PageHeading
        eyebrow="COURSE CREDENTIALS"
        title="Certificate status"
        description={
          isEmployee
            ? 'Track the verification status of certificates you uploaded.'
            : 'Track uploaded certificates for your courses and see which ones are awaiting verification.'
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
            icon={FileCheck2}
            title="No uploaded certificates"
            detail={
              isEmployee
                ? 'Certificates you submit for verification will appear here with their current status.'
                : 'Certificates submitted for your courses will appear here with their verification status.'
            }
          />
        )}
      </section>
    </>
  )
}