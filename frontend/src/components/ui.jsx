import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, X } from 'lucide-react'
import { api, unwrap } from '../api'
import { messageOf, records } from '../utils'

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow small-eyebrow">
          {eyebrow}
        </div>

        <h1>{title}</h1>
        <p>{description}</p>
      </div>

      {action}
    </div>
  )
}

export function LoadingCards() {
  return (
    <div className="stats-grid">
      {[1, 2, 3, 4].map((n) => (
        <div
          className="stat-card skeleton"
          key={n}
        >
          <i />
          <b />
          <small />
        </div>
      ))}
    </div>
  )
}

export function ErrorNotice({ error }) {
  return error ? (
    <div
      className="inline-error"
      role="alert"
    >
      {messageOf(error)}

      {error.correlationId && (
        <small className="error-reference">
          Reference: {error.correlationId}
        </small>
      )}
    </div>
  ) : null
}

export function EmptyState({
  icon: Icon = BookOpen,
  title,
  detail,
  action,
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={22} />
      </div>

      <h3>{title}</h3>
      <p>{detail}</p>

      {action}
    </div>
  )
}

export function ListPage({
  endpoint,
  queryKey,
  title,
  description,
  eyebrow,
  columns,
  emptyTitle,
  emptyDetail,
  action,
  filter,
}) {
  const query = useQuery({
    queryKey: [queryKey, filter],
    queryFn: () =>
      api.get(
        `${endpoint}${
          endpoint.includes('?') ? '&' : '?'
        }page=1&limit=50${
          filter ? `&${filter}` : ''
        }`
      ),
  })

  const rows = records(unwrap(query.data))

  return (
    <>
      <PageHeading
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={action}
      />

      <ErrorNotice error={query.error} />

      <section className="panel table-panel">
        {query.isLoading ? (
          <div className="table-skeleton" />
        ) : rows.length ? (
          <DataTable
            rows={rows}
            columns={columns}
          />
        ) : (
          <EmptyState
            title={emptyTitle}
            detail={emptyDetail}
          />
        )}
      </section>
    </>
  )
}

export function DataTable({
  rows,
  columns,
  onSelect,
}) {
  return (
    <div
      className={`table-wrap ${
        onSelect ? 'table-selectable' : ''
      }`}
    >
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr
              key={
                row._id ||
                row.id ||
                index
              }
              onClick={() => onSelect?.(row)}
            >
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render
                    ? col.render(row)
                    : (
                        col.path || col.key
                      )
                        .split('.')
                        .reduce(
                          (obj, key) =>
                            obj?.[key],
                          row
                        ) ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Modal({
  title,
  children,
  onClose,
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <motion.div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{
          opacity: 0,
          y: 12,
          scale: 0.985,
        }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        exit={{
          opacity: 0,
          y: 8,
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow small-eyebrow">
              NEXORA WORKSPACE
            </span>

            <h2>{title}</h2>
          </div>

          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {children}
      </motion.div>
    </div>
  )
}