export const roleNames = {
  admin: 'Administrator',
  trainer: 'Trainer',
  employee: 'Employee',
}

// Sidebar navigation per role: [label, lucide icon name]
export const roleNav = {
  admin: [
    ['Overview', 'LayoutDashboard'],
    ['People', 'Users'],
    ['Domains', 'BriefcaseBusiness'],
    ['Courses', 'BookOpen'],
    ['Assignment rules', 'ClipboardCheck'],
    ['Approvals', 'FileCheck2'],
    ['Certificate verification', 'FileCheck2'],
    ['Issued certificates', 'Award'],
    ['Reports', 'Activity'],
    ['Audit log', 'ShieldCheck'],
    ['Settings', 'Settings'],
  ],
  trainer: [
    ['Overview', 'LayoutDashboard'],
    ['My courses', 'BookOpen'],
    ['Certificate reviews', 'FileCheck2'],
    ['Certificate status', 'Award'],
    ['Analytics', 'Activity'],
    ['Notifications', 'Bell'],
  ],
  employee: [
    ['My learning', 'LayoutDashboard'],
    ['My certificates', 'FileCheck2'],
    ['Certificate status', 'Award'],
    ['Notifications', 'Bell'],
  ],
}

const RECORD_KEYS = [
  'items',
  'results',
  'rows',
  'records',
  'users',
  'courses',
  'assignments',
  'certificates',
  'notifications',
  'domains',
  'rules',
  'logs',
]

export function messageOf(error) {
  return error?.message || 'Something went wrong. Please try again.'
}

// Normalizes API list responses into a plain array
export function records(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  for (const key of RECORD_KEYS) {
    if (Array.isArray(value[key])) return value[key]
  }
  return []
}

export function initials(name = '') {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(word => word[0])
      .join('')
      .toUpperCase() || 'N'
  )
}

export function pretty(value = '') {
  return String(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function date(value) {
  return value
    ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(
        new Date(value),
      )
    : '—'
}

export function statusClass(value = '') {
  return `status status-${String(value).toLowerCase().replaceAll('_', '-')}`
}

// Returns the first defined, non-null value among keys (or 0)
export function statValue(obj, ...keys) {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key]
  }
  return 0
}