import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Check, ChevronLeft, ClipboardCheck, ExternalLink } from 'lucide-react'
import { api, unwrap } from '../api'
import { messageOf, pretty } from '../utils'
import { EmptyState, PageHeading } from '../components/ui'
import { QuizFlow } from './QuizFlow'
import { YouTubeLesson } from './YouTubeLesson'

export function CoursePlayer({ assignment, onBack, onNavigate, notify }) {
  const qc = useQueryClient()
  const id = assignment._id || assignment.id

  const detail = useQuery({
    queryKey: ['assignment', id],
    queryFn: () => api.get(`/assignments/${id}`),
  })
  const data = unwrap(detail.data) || assignment
  const course = data.courseId || data.course || {}
  const modules = course.modules || data.modules || []

  const [activeId, setActiveId] = useState(null)
  const [showQuiz, setShowQuiz] = useState(false)
  const [completingId, setCompletingId] = useState(null)
  const [pdfUrl, setPdfUrl] = useState(null)

  const active = modules.find(m => (m._id || m.id) === activeId) || modules[0]

  // ---------------------------------------------------------------------------
  // Load PDF lesson as a blob URL
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let objectUrl
    let cancelled = false

    if (active?.type === 'pdf' && active.uploadId) {
      api
        .file(`/uploads/${active.uploadId}`)
        .then(blob => {
          if (cancelled) return
          objectUrl = URL.createObjectURL(blob)
          setPdfUrl(objectUrl)
        })
        .catch(error => notify({ message: messageOf(error), type: 'error' }))
    }
    setPdfUrl(null)

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [active?.type, active?.uploadId])

  // ---------------------------------------------------------------------------
  // Progress
  // ---------------------------------------------------------------------------
  const progress = data.moduleProgress || []
  const completedIds = new Set(
    progress
      .filter(p => p.completed || p.completedAt)
      .map(p => String(p.moduleId?._id || p.moduleId || p._id)),
  )
  const requiredModules = modules.filter(module => module.isRequired !== false)
  const requiredDone = requiredModules.filter(module =>
    completedIds.has(String(module._id || module.id)),
  ).length
  const quizUnlocked = requiredDone >= requiredModules.length

  const activeProgress =
    active &&
    progress.find(
      item => String(item.moduleId?._id || item.moduleId) === String(active._id || active.id),
    )

  const refreshProgress = () => {
    qc.invalidateQueries({ queryKey: ['assignment', id] })
    qc.invalidateQueries({ queryKey: ['assignments-me'] })
  }

  const complete = async module => {
    const moduleId = String(module._id || module.id)
    setCompletingId(moduleId)
    try {
      await api.post(`/assignments/${id}/modules/${moduleId}/complete`)
      await refreshProgress()
      notify({ message: 'Module completed' })
    } catch (e) {
      notify({ message: messageOf(e), type: 'error' })
    } finally {
      setCompletingId(null)
    }
  }

  const videoId = active?.youtubeVideoId || ''
  const activeDone = active && completedIds.has(String(active._id || active.id))
  const activeIsCompleting = active && completingId === String(active._id || active.id)
  const percentComplete = modules.length ? (completedIds.size / modules.length) * 100 : 0

  // ---------------------------------------------------------------------------
  // Lesson content by module type
  // ---------------------------------------------------------------------------
  const renderLesson = () => {
    if (active.type === 'youtube' && videoId) {
      return (
        <YouTubeLesson
          videoId={videoId}
          assignmentId={id}
          module={active}
          initialWatched={activeProgress?.watchedSeconds || 0}
          initialPosition={activeProgress?.lastPositionSeconds || 0}
          notify={notify}
          onProgress={refreshProgress}
        />
      )
    }

    if (active.type === 'pdf' && active.uploadId) {
      return pdfUrl ? (
        <iframe
          title={`${active.title} PDF`}
          src={pdfUrl}
          style={{ width: '100%', height: 'min(75vh, 850px)', border: 0 }}
        />
      ) : (
        <div className="module-placeholder">
          <BookOpen size={28} />
          <h3>{active.title}</h3>
          <p>Loading lesson…</p>
        </div>
      )
    }

    if (active.type === 'note') {
      return (
        <div className="note-content">
          <h3>{active.title}</h3>
          {active.notes}
        </div>
      )
    }

    if (active.type === 'link') {
      return (
        <div className="module-placeholder">
          <ExternalLink size={28} />
          <h3>{active.title}</h3>
          <p>Open the linked learning material in a new tab.</p>
          <a className="button outline" href={active.sourceUrl} target="_blank" rel="noreferrer">
            Open learning link <ExternalLink size={14} />
          </a>
        </div>
      )
    }

    return (
      <div className="module-placeholder">
        <BookOpen size={28} />
        <h3>{active.title}</h3>
        <p>{active.notes || 'Open this module content and mark it complete when you finish.'}</p>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ChevronLeft size={16} /> Back to my learning
      </button>

      <PageHeading
        eyebrow="COURSE PLAYER"
        title={course.title || assignment.courseTitle || 'Learning course'}
        description={
          course.description || 'Work through each module. Your course progress is saved as you go.'
        }
      />

      <div className="player-layout">
        {/* Module sidebar */}
        <aside className="panel module-sidebar">
          <div className="module-summary">
            <b>Course modules</b>
            <span>
              {completedIds.size} / {modules.length} complete
            </span>
            <div className="progress-track">
              <i style={{ width: `${percentComplete}%` }} />
            </div>
          </div>

          {modules.map((module, index) => {
            const moduleId = module._id || module.id
            const done = completedIds.has(String(moduleId))
            const isCurrent = String(active?._id || active?.id) === String(moduleId)

            return (
              <button
                className={`module-item ${isCurrent ? 'current' : ''}`}
                key={moduleId}
                onClick={() => {
                  setActiveId(moduleId)
                  setShowQuiz(false)
                }}
              >
                <span className={`module-number ${done ? 'done' : ''}`}>
                  {done ? <Check size={13} /> : String(index + 1).padStart(2, '0')}
                </span>
                <span>
                  <b>{module.title}</b>
                  <small>{pretty(module.type || 'module')}</small>
                </span>
              </button>
            )
          })}

          {!modules.length && <p className="muted">Course modules could not be loaded.</p>}
        </aside>

        {/* Main lesson area */}
        <section className="panel player-main">
          {detail.isLoading ? (
            <div className="table-skeleton" />
          ) : showQuiz ? (
            <QuizFlow
              assignmentId={id}
              autoStart
              notify={notify}
              onPassed={() => {
                refreshProgress()
                onBack()
                onNavigate('My certificates')
              }}
            />
          ) : active ? (
            <>
              <div className="player-content">{renderLesson()}</div>

              <div className="player-footer">
                <div>
                  <span className="eyebrow small-eyebrow">
                    MODULE {String(modules.indexOf(active) + 1).padStart(2, '0')} OF{' '}
                    {String(modules.length).padStart(2, '0')}
                  </span>
                  <h2>{active.title}</h2>
                </div>

                {activeDone ? (
                  <span className="completed-label">
                    <Check size={15} /> Completed
                  </span>
                ) : (
                  <button
                    className="button primary"
                    disabled={activeIsCompleting}
                    onClick={() => complete(active)}
                  >
                    {activeIsCompleting ? 'Saving...' : 'Mark complete'} <Check size={15} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <EmptyState title="Choose a module" detail="Select a module from the course outline." />
          )}
        </section>
      </div>

      {/* Assessment launcher */}
      {!showQuiz && (
        <section className="panel quiz-launch">
          <div className="quiz-icon">
            <ClipboardCheck size={19} />
          </div>
          <div className="grow">
            <b>Course assessment</b>
            <small>
              {quizUnlocked
                ? 'Required modules are complete. You can start the assessment.'
                : `Complete required modules to unlock the assessment (${requiredDone}/${requiredModules.length}).`}
            </small>
          </div>
          <button
            className="button primary"
            disabled={!quizUnlocked}
            onClick={() => setShowQuiz(true)}
          >
            Start quiz <Check size={15} />
          </button>
        </section>
      )}
    </>
  )
}