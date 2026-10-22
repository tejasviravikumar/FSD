import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  FileCheck2,
  FilePlus2,
  Filter,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { api, unwrap } from '../api'
import { date, pretty, records, roleNames, statusClass, statValue } from '../utils'
import { PageHeading, EmptyState, ErrorNotice } from '../components/ui'
import { CoursePlayer } from './CoursePlayer'

const certificateTitle = c =>
  c.courseId?.title ||
  c.course?.title ||
  c.title ||
  c.courseTitle ||
  c.certificateNumber ||
  'Certificate'

export function Dashboard({ user, notify, onNavigate }) {
  const queryClient = useQueryClient()
  const [selectedAssignment, setSelectedAssignment] = useState(null)

  const role = user?.role || 'employee'
  const isEmployee = role === 'employee'
  const canViewReports =
    role === 'admin' || role === 'trainer' || (role === 'employee' && user?.isManager === true)

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  const employeeQuery = useQuery({
    queryKey: ['assignments-me'],
    queryFn: () => api.get('/assignments/me'),
    enabled: role === 'employee',
  })
  const certQuery = useQuery({
    queryKey: ['certificates-me'],
    queryFn: () => api.get('/certificates/me'),
    enabled: role === 'employee',
  })
  const courseQuery = useQuery({
    queryKey: ['courses'],
    queryFn: () => api.get('/courses?page=1&limit=8'),
  })
  const complianceQuery = useQuery({
    queryKey: ['report-compliance', role, user?._id],
    queryFn: () => api.get('/reports/compliance'),
    enabled: canViewReports,
  })
  const overdueQuery = useQuery({
    queryKey: ['report-overdue', role, user?._id],
    queryFn: () => api.get('/reports/overdue'),
    enabled: canViewReports,
  })
  const expiringQuery = useQuery({
    queryKey: ['certificates-expiring'],
    queryFn: () => api.get('/certificates/expiring?days=60'),
    enabled: role !== 'employee',
  })

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const assignments = records(unwrap(employeeQuery.data))
  const courses = records(unwrap(courseQuery.data))

  // Latest certificate per course
  const certs = [
    ...new Map(
      records(unwrap(certQuery.data))
        .sort((a, b) => new Date(b.issueDate || 0) - new Date(a.issueDate || 0))
        .map(c => {
          const course =
            typeof c.courseId === 'object' ? c.courseId?.title || c.courseId?._id : c.courseId
          const title = certificateTitle(c)
          return [String(course || title).trim().toLowerCase(), c]
        }),
    ).values(),
  ]

  const complianceData = unwrap(complianceQuery.data) || {}
  const complianceItems = records(complianceData)
  const totalMandatory = complianceItems.reduce((sum, row) => sum + Number(row.total || 0), 0)
  const compliantMandatory = complianceItems.reduce(
    (sum, row) => sum + Number(row.compliant || 0),
    0,
  )
  const percent = Number(
    statValue(complianceData, 'compliancePercent', 'complianceRate', 'percentage') ||
      (totalMandatory ? (compliantMandatory / totalMandatory) * 100 : 0),
  )

  const overdue = records(unwrap(overdueQuery.data)).length
  const completed = assignments.filter(item => item.status === 'completed').length
  const expiring = isEmployee
    ? certs.filter(c => c.status === 'expiring_soon').length
    : records(unwrap(expiringQuery.data)).length

  const stats = isEmployee
    ? [
        {
          label: 'Assigned learning',
          value: assignments.length,
          note: 'Courses in your plan',
          icon: BookOpen,
          tint: 'lavender',
        },
        {
          label: 'Completed',
          value: completed,
          note: 'Learning milestones reached',
          icon: Check,
          tint: 'mint',
        },
        {
          label: 'In progress',
          value: assignments.filter(a => a.status === 'in_progress').length,
          note: 'Pick up where you left off',
          icon: Activity,
          tint: 'blue',
        },
        {
          label: 'Certificates',
          value: certs.length,
          note: `${expiring} need attention`,
          icon: FileCheck2,
          tint: 'peach',
        },
      ]
    : [
        {
          label: 'Compliance',
          value: percent ? `${Math.round(percent)}%` : '--',
          note: 'Across your current scope',
          icon: ShieldCheck,
          tint: 'mint',
        },
        {
          label: 'Overdue assignments',
          value: overdue,
          note: 'Require follow-up',
          icon: Clock3,
          tint: 'peach',
        },
        {
          label: 'Expiring soon',
          value: expiring,
          note: 'Within the next 60 days',
          icon: FileCheck2,
          tint: 'lavender',
        },
        {
          label: role === 'admin' ? 'Published courses' : 'My courses',
          value: courses.filter(c => (role === 'admin' ? c.status === 'published' : true)).length,
          note: 'In the learning catalog',
          icon: BookOpen,
          tint: 'blue',
        },
      ]

  const firstName = user?.name?.split(' ')[0] || 'there'
  const catalogPage = role === 'trainer' ? 'My courses' : 'Courses'

  if (selectedAssignment) {
    return (
      <CoursePlayer
        assignment={selectedAssignment}
        onBack={() => setSelectedAssignment(null)}
        onNavigate={onNavigate}
        notify={notify}
      />
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <PageHeading
        eyebrow={
          isEmployee
            ? 'YOUR LEARNING JOURNEY'
            : `NEXORA / ${roleNames[role]?.toUpperCase() || 'WORKSPACE'}`
        }
        title={isEmployee ? `Good to see you, ${firstName}.` : `Good morning, ${firstName}.`}
        description={
          isEmployee
            ? "A little progress every day adds up. Here's your next step."
            : "Here's a snapshot of learning and compliance across your workspace."
        }
        action={
          <button
            className="button subtle"
            onClick={() => {
              queryClient.invalidateQueries()
              notify({ message: 'Workspace data refreshed' })
            }}
          >
            <Activity size={15} /> Refresh
          </button>
        }
      />

      <ErrorNotice
        error={
          employeeQuery.error ||
          certQuery.error ||
          complianceQuery.error ||
          overdueQuery.error ||
          courseQuery.error ||
          expiringQuery.error
        }
      />

      {/* Stat cards */}
      <motion.div
        className="stats-grid"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
      >
        {stats.map(({ label, value, note, icon: Icon, tint }) => (
          <motion.article
            className="stat-card"
            key={label}
            variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
          >
            <div className="stat-head">
              <span>{label}</span>
              <span className={`stat-icon ${tint}`}>
                <Icon size={17} />
              </span>
            </div>
            <div className="stat-value">{value}</div>
            <div className="stat-note">
              <span className="note-dot" />
              {note}
            </div>
          </motion.article>
        ))}
      </motion.div>

      {/* Main columns */}
      {isEmployee ? (
        <div className="dashboard-columns">
          <section className="panel learning-panel">
            <div className="panel-header">
              <div>
                <h2>Pick up where you left off</h2>
                <p>Your active learning, sorted by urgency</p>
              </div>
              <button className="link-button" onClick={() => onNavigate('My learning')}>
                All learning <ArrowRight size={14} />
              </button>
            </div>

            {assignments.length ? (
              assignments
                .slice(0, 4)
                .map(a => (
                  <LearningRow key={a._id || a.id} item={a} onClick={() => setSelectedAssignment(a)} />
                ))
            ) : (
              <EmptyState
                icon={Sparkles}
                title="Your learning plan is ready"
                detail="Assigned courses will appear here when they're added to your plan."
                action={
                  <button className="button subtle" onClick={() => onNavigate('My learning')}>
                    Browse learning <ArrowRight size={15} />
                  </button>
                }
              />
            )}
          </section>

          <section className="panel side-panel">
            <div className="panel-header">
              <div>
                <h2>Stay certified</h2>
                <p>Your current certificates</p>
              </div>
              <button
                className="icon-button"
                aria-label="View certificates"
                onClick={() => onNavigate('My certificates')}
              >
                <ArrowUpRight size={17} />
              </button>
            </div>

            {certs.slice(0, 3).map(c => (
              <div className="compact-cert" key={c._id || c.id}>
                <div className="cert-icon">
                  <FileCheck2 size={16} />
                </div>
                <div className="grow">
                  <b>{certificateTitle(c)}</b>
                  <small>
                    {c.expiryDate || c.validUntil || c.expiresAt
                      ? `Valid until ${date(c.expiryDate || c.validUntil || c.expiresAt)}`
                      : `Issued ${date(c.issueDate || c.issuedAt)}`}
                  </small>
                </div>
                <span className={statusClass(c.status)}>{pretty(c.status || 'valid')}</span>
              </div>
            ))}

            {!certs.length && (
              <p className="muted small">Certificates earned from completed courses show up here.</p>
            )}

            <button className="button outline full" onClick={() => onNavigate('My certificates')}>
              View certificates <ArrowRight size={15} />
            </button>
          </section>
        </div>
      ) : (
        <div className="dashboard-columns">
          <section className="panel chart-panel">
            <div className="panel-header">
              <div>
                <h2>Compliance overview</h2>
                <p>Percent of assigned mandatory courses completed (higher is better).</p>
              </div>
              <span className="period-pill">Current</span>
            </div>
            <ComplianceChart rows={complianceItems} />
          </section>

          <section className="panel side-panel">
            <div className="panel-header">
              <div>
                <h2>Needs attention</h2>
                <p>Actions to keep learning on track</p>
              </div>
              <span className="attention-mark">
                <Activity size={16} />
              </span>
            </div>
            <AttentionRow
              number={overdue}
              label="Overdue assignments"
              hint="Follow up with your team"
              onClick={() => onNavigate('Reports')}
            />
            <AttentionRow
              number={expiring}
              label="Certificates expiring"
              hint="Renewal may be needed"
              onClick={() => onNavigate('Reports')}
            />
            <AttentionRow
              number={courses.filter(c => c.status === 'under_review').length}
              label="Courses awaiting review"
              hint="Trainer submissions"
              onClick={() => onNavigate('Approvals')}
            />
          </section>
        </div>
      )}

      {/* Catalog preview */}
      <section className="panel bottom-panel">
        <div className="panel-header">
          <div>
            <h2>{isEmployee ? 'Recommended next' : 'Learning catalog'}</h2>
            <p>
              {isEmployee
                ? 'Explore what is available to build your skills'
                : 'Courses visible to your role'}
            </p>
          </div>
          <button className="link-button" onClick={() => onNavigate(catalogPage)}>
            Open catalog <ArrowRight size={14} />
          </button>
        </div>

        {courses.length ? (
          <div className="course-grid">
            {courses.slice(0, 3).map(c => (
              <CourseCard key={c._id || c.id} course={c} onClick={() => onNavigate(catalogPage)} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Your catalog is taking shape"
            detail="Published courses will appear here when available."
          />
        )}
      </section>
    </>
  )
}

export function LearningRow({ item, onClick }) {
  const course =
    item.course || (item.courseId && typeof item.courseId === 'object' ? item.courseId : {})
  const domain = course.domain || course.domainId || item.domain || {}

  const done = item.moduleProgress?.filter(m => m.completedAt).length || item.completedModules || 0
  const total = item.modules?.length || course.modules?.length || item.totalModules || 0
  const pct =
    item.status === 'completed'
      ? 100
      : total
        ? Math.round((done / total) * 100)
        : item.progressPercent || 0

  const due = item.dueDate ? Math.ceil((new Date(item.dueDate) - new Date()) / 86400000) : null
  const isOverdue = item.status === 'overdue' || (due !== null && due < 0)

  const dueLabel = isOverdue
    ? 'Overdue'
    : due === 0
      ? 'Due today'
      : due !== null && due < 8
        ? `${due} days left`
        : item.status === 'completed'
          ? 'Completed'
          : `Due ${date(item.dueDate)}`

  return (
    <button className="learning-row" onClick={onClick}>
      <span className="learning-thumb">
        <BookOpen size={19} />
      </span>
      <span className="learning-main">
        <span className="learning-title">{course.title || item.courseTitle || 'Assigned course'}</span>
        <span className="learning-meta">
          {domain.name || 'Learning path'} <i /> {total ? `${total} modules` : 'Modules not available'}
        </span>
        <span className="progress-track">
          <i style={{ width: `${Math.min(100, pct)}%` }} />
        </span>
      </span>
      <span className="learning-side">
        <b>{pct}%</b>
        <span className={isOverdue ? 'due danger' : 'due'}>{dueLabel}</span>
      </span>
      <ChevronRight size={15} className="row-arrow" />
    </button>
  )
}

export function CourseCard({ course, onClick }) {
  return (
    <button className="course-card" onClick={onClick}>
      <div className="course-cover">
        <span>{(course.domain?.name || course.domainName || 'NX').slice(0, 2).toUpperCase()}</span>
        <BookOpen size={21} />
      </div>
      <div className="course-info">
        <div className="course-topline">
          <span>{course.domain?.name || course.domainName || 'Nexora learning'}</span>
          <span className={statusClass(course.status)}>{pretty(course.status || 'published')}</span>
        </div>
        <h3>{course.title || 'Untitled course'}</h3>
        <small className="muted">{course.courseCode}</small>
        <p>{course.description || 'Explore this learning experience and build a new skill.'}</p>
        <span className="course-foot">
          {course.durationMinutes || course.duration || 'Self-paced'}{' '}
          {course.durationMinutes ? 'min' : ''}
          <ArrowRight size={14} />
        </span>
      </div>
    </button>
  )
}

export function AttentionRow({ number, label, hint, onClick }) {
  return (
    <button className="attention-row" onClick={onClick}>
      <span className="attention-number">{number}</span>
      <span className="grow">
        <b>{label}</b>
        <small>{hint}</small>
      </span>
      <ChevronRight size={15} />
    </button>
  )
}

export function ComplianceChart({ rows }) {
  const data = rows.slice(0, 5).map((r, i) => {
    const total = Number(r.total ?? r.assigned ?? 0)
    const completed = Number(r.compliant ?? r.completed ?? 0)
    const value = Number(
      r.compliancePercent ??
        r.complianceRate ??
        r.percentage ??
        r.completionRate ??
        (total ? (completed / total) * 100 : 0),
    )
    return {
      label:
        [r.domainName || r.domain?.name, r.courseTitle].filter(Boolean).join(' / ') ||
        r.location ||
        `Group ${i + 1}`,
      value,
      total,
      completed,
    }
  })

  if (!data.length) {
    return (
      <div className="chart-empty">
        <div className="donut">
          <span>
            --<small>compliant</small>
          </span>
        </div>
        <p>No mandatory-course compliance records are available in this scope yet.</p>
      </div>
    )
  }

  return (
    <div className="rechart-wrap">
      <ResponsiveContainer width="100%" height={205}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 22, left: 2, bottom: 4 }}
          barSize={13}
        >
          <CartesianGrid horizontal={false} stroke="#eff0f3" />
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={v => `${v}%`}
            tick={{ fill: '#9aa1aa', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={150}
            tick={{ fill: '#7e8793', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v, _name, item) => [
              `${Math.round(Number(v))}% (${item.payload.completed}/${item.payload.total})`,
              'Completed / assigned',
            ]}
            contentStyle={{ border: '1px solid #ececf1', borderRadius: 8, fontSize: 10 }}
          />
          <Bar dataKey="value" fill="#796bd5" radius={[0, 5, 5, 0]} animationDuration={550} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}