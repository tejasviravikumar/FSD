import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion'
import { useLocation } from 'react-router-dom'
import {
  Activity,
  ArrowUpRight,
  Award,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  FileCheck2,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { api, unwrap } from '../api'
import {
  initials,
  pretty,
  records,
  roleNames,
  roleNav,
} from '../utils'
import { LoadingCards } from '../components/ui'

const Dashboard = lazy(() =>
  import('../pages/Dashboard').then((module) => ({
    default: module.Dashboard,
  }))
)

const CoursePlayer = lazy(() =>
  import('../pages/CoursePlayer').then((module) => ({
    default: module.CoursePlayer,
  }))
)

const CoursesPage = lazy(() =>
  import('../pages/CoursesPage').then((module) => ({
    default: module.CoursesPage,
  }))
)

const PeoplePage = lazy(() =>
  import('../pages/AdminPages').then((module) => ({
    default: module.PeoplePage,
  }))
)

const DomainsPage = lazy(() =>
  import('../pages/AdminPages').then((module) => ({
    default: module.DomainsPage,
  }))
)

const RulesPage = lazy(() =>
  import('../pages/AdminPages').then((module) => ({
    default: module.RulesPage,
  }))
)

const ApprovalsPage = lazy(() =>
  import('../pages/AdminPages').then((module) => ({
    default: module.ApprovalsPage,
  }))
)

const CertificateReviewPage = lazy(() =>
  import('../pages/AdminPages').then((module) => ({
    default: module.CertificateReviewPage,
  }))
)

const TrainerCertificateStatusPage = lazy(() =>
  import('../pages/OperationsPages').then((module) => ({
    default: module.TrainerCertificateStatusPage,
  }))
)

const IssuedCertificatesPage = lazy(() =>
  import('../pages/AdminPages').then((module) => ({
    default: module.IssuedCertificatesPage,
  }))
)

const ReportsPage = lazy(() =>
  import('../pages/OperationsPages').then((module) => ({
    default: module.ReportsPage,
  }))
)

const AuditPage = lazy(() =>
  import('../pages/OperationsPages').then((module) => ({
    default: module.AuditPage,
  }))
)

const SettingsPage = lazy(() =>
  import('../pages/OperationsPages').then((module) => ({
    default: module.SettingsPage,
  }))
)

const NotificationsPage = lazy(() =>
  import('../pages/OperationsPages').then((module) => ({
    default: module.NotificationsPage,
  }))
)

const CertificatesPage = lazy(() =>
  import('../pages/OperationsPages').then((module) => ({
    default: module.CertificatesPage,
  }))
)

const TeamPage = lazy(() =>
  import('../pages/ManagerPages').then((module) => ({
    default: module.TeamPage,
  }))
)

const navIcons = {
  Activity,
  Award,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  ClipboardCheck,
  FileCheck2,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
}

export function Shell({
  user: initialUser,
  onLogout,
  notify,
}) {
  const [active, setActive] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState(initialUser)
  const [selectedCourseAssignment, setSelectedCourseAssignment] =
    useState(null)

  const reduceMotion = useReducedMotion()
  const location = useLocation()

  const role = user?.role || 'employee'

  const { data: notifsResult } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get(
        '/notifications?page=1&limit=100&unreadOnly=true'
      ),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const notifications = records(unwrap(notifsResult))

  const unread = notifications.filter(
    (n) => !n.readAt
  ).length

  const navItems =
    user?.isManager && role === 'employee'
      ? [
          ...roleNav.employee,
          ['My team', 'Users'],
          ['Team reports', 'Activity'],
        ]
      : roleNav[role] || roleNav.employee

  const current = active || navItems[0][0]

  const title =
    current === 'My learning'
      ? 'My learning'
      : current === 'My courses'
        ? 'My courses'
        : current

  useEffect(() => {
    if (location.pathname.startsWith('/')) {
      setActive('')
    }
  }, [location.pathname])

  useEffect(() => {
    if (role !== 'employee') return

    api
      .get('/auth/me')
      .then((result) => {
        const profile = unwrap(result)

        setUser((prev) => ({
          ...prev,
          ...profile,
          isManager: Boolean(profile?.isManager),
        }))
      })
      .catch(() => {})
  }, [role])

  const go = (item) => {
    setActive(item)
    setMobileOpen(false)
  }

  const page = useMemo(() => {
    if (selectedCourseAssignment) {
      return (
        <CoursePlayer
          assignment={selectedCourseAssignment}
          onBack={() => setSelectedCourseAssignment(null)}
          onNavigate={go}
          notify={notify}
        />
      )
    }

    if (
      current === 'Overview' ||
      current === 'My learning'
    ) {
      return (
        <Dashboard
          user={user}
          notify={notify}
          onNavigate={go}
        />
      )
    }

    if (current === 'Notifications') {
      return <NotificationsPage notify={notify} />
    }

    if (current === 'My team') {
      return <TeamPage notify={notify} />
    }

    if (current === 'Team reports') {
      return <ReportsPage role="manager" />
    }

    if (current === 'My certificates') {
      return <CertificatesPage notify={notify} />
    }

    if (current === 'People') {
      return <PeoplePage notify={notify} />
    }

    if (current === 'Domains') {
      return <DomainsPage notify={notify} />
    }

    if (current === 'Assignment rules') {
      return <RulesPage notify={notify} />
    }

    if (current === 'Approvals') {
      return <ApprovalsPage notify={notify} />
    }

    if (
      current === 'Certificate reviews' ||
      current === 'Certificate verification'
    ) {
      return <CertificateReviewPage notify={notify} />
    }

    if (current === 'Certificate status') {
      return (
        <TrainerCertificateStatusPage
          role={role}
          notify={notify}
        />
      )
    }

    if (current === 'Issued certificates') {
      return <IssuedCertificatesPage notify={notify} />
    }

    if (
      current === 'Reports' ||
      current === 'Analytics'
    ) {
      return (
        <ReportsPage
          role={role}
          user={user}
        />
      )
    }

    if (current === 'Audit log') {
      return <AuditPage />
    }

    if (current === 'Settings') {
      return <SettingsPage notify={notify} />
    }

    return (
      <CoursesPage
        role={role}
        user={user}
        notify={notify}
        onSelectCourse={setSelectedCourseAssignment}
      />
    )
  }, [
    current,
    user,
    notify,
    role,
    selectedCourseAssignment,
  ])

  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${
          mobileOpen ? 'sidebar-open' : ''
        }`}
      >
        <div className="side-brand">
          <div className="brand-mark">
            <GraduationCap size={21} />
          </div>

          <span>
            NEXORA
            <span className="brand-light">
              {' '}
              / LEARNING
            </span>
          </span>

          <button
            aria-label="Close menu"
            className="icon-button mobile-close"
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="workspace-label">
          WORKSPACE
        </div>

        <nav className="side-nav">
          {navItems.map(([label, icon]) => {
            const NavIcon =
              navIcons[icon] || BookOpen

            return (
              <button
                key={label}
                className={`nav-item ${
                  current === label ? 'selected' : ''
                }`}
                onClick={() => go(label)}
              >
                <NavIcon size={17} />

                <span>{label}</span>

                {label === 'Notifications' &&
                  unread > 0 && (
                    <i className="nav-count">
                      {unread}
                    </i>
                  )}

                {current === label && (
                  <ChevronRight
                    className="nav-chevron"
                    size={15}
                  />
                )}
              </button>
            )
          })}
        </nav>

        {user?.isManager &&
          role === 'employee' && (
            <div className="manager-note">
              <Users size={15} />
              <span>Manager access active</span>
            </div>
          )}

        <div className="side-bottom">
          <div className="help-card">
            <div className="help-icon">
              <CircleHelp size={16} />
            </div>

            <div>
              <b>Need a hand?</b>
              <small>Visit the learning hub</small>
            </div>

            <ArrowUpRight size={14} />
          </div>

          <button
            className="profile-row"
            onClick={onLogout}
          >
            <span className="user-avatar">
              {initials(user?.name)}
            </span>

            <span className="profile-copy">
              <b>
                {user?.name || 'Nexora user'}
              </b>

              <small>
                {roleNames[role] || pretty(role)}
              </small>
            </span>

            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </button>

          <div className="crumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>

          <div className="top-actions">
            <span className="top-date">
              {new Intl.DateTimeFormat('en', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              }).format(new Date())}
            </span>

            <button
              className="icon-button notification-button"
              onClick={() => go('Notifications')}
              aria-label={`${unread} unread notifications`}
            >
              <Bell size={18} />

              {unread > 0 && <i />}
            </button>

            <div className="top-divider" />

            {role === 'admin' ? (
              <button
                className="top-user"
                onClick={() => go('Settings')}
                aria-label="Open settings"
              >
                <span className="user-avatar small">
                  {initials(user?.name)}
                </span>

                <ChevronDown size={14} />
              </button>
            ) : (
              <span
                className="top-user"
                title={user?.name}
              >
                <span className="user-avatar small">
                  {initials(user?.name)}
                </span>
              </span>
            )}
          </div>
        </header>

        <div className="page-scroll">
          <AnimatePresence mode="wait">
            <motion.div
              key={
                current + location.pathname
              }
              className="page-content"
              initial={
                reduceMotion
                  ? false
                  : {
                      opacity: 0,
                      y: 8,
                    }
              }
              animate={{
                opacity: 1,
                y: 0,
              }}
              exit={
                reduceMotion
                  ? {}
                  : {
                      opacity: 0,
                      y: -5,
                    }
              }
              transition={{
                duration: reduceMotion ? 0 : 0.2,
              }}
            >
              <Suspense fallback={<LoadingCards />}>
                {page}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}