import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, CircleHelp, Clock3, RotateCcw, Trophy } from 'lucide-react'
import { api, unwrap } from '../api'
import { messageOf } from '../utils'

const secondsRemaining = (startedAt, timeLimitMinutes) =>
  Math.max(
    0,
    Math.ceil((new Date(startedAt).getTime() + timeLimitMinutes * 60000 - Date.now()) / 1000),
  )

export function QuizFlow({ assignmentId, onPassed, notify, autoStart = false }) {
  const [questions, setQuestions] = useState([])
  const [attempt, setAttempt] = useState(null)
  const [timeLimit, setTimeLimit] = useState(null)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(null)

  const timeoutSubmitted = useRef(false)
  const autoStarted = useRef(false)
  const startRef = useRef(null)
  const submitRef = useRef(null)

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const data = unwrap(await api.post(`/assignments/${assignmentId}/attempts`))
      timeoutSubmitted.current = false
      setAttempt(data.attempt)
      setQuestions(data.questions || [])
      setTimeLimit(data.timeLimitMinutes)
      setSecondsLeft(
        data.timeLimitMinutes
          ? secondsRemaining(data.attempt.startedAt, data.timeLimitMinutes)
          : null,
      )
      setStep(0)
      setAnswers({})
      setResult(null)
    } catch (e) {
      setError(messageOf(e))
      notify({ message: messageOf(e), type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const choose = (question, optionId) => {
    const current = answers[question.id] || (question.type === 'multiple_choice' ? [] : '')
    const next =
      question.type === 'multiple_choice'
        ? current.includes(optionId)
          ? current.filter(x => x !== optionId)
          : [...current, optionId]
        : optionId
    setAnswers(prev => ({ ...prev, [question.id]: next }))
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const data = unwrap(await api.post(`/attempts/${attempt._id}/submit`, { answers }))
      setResult(data)
      notify({
        message: data.attempt?.passed
          ? 'Assessment passed. Your certificate is ready.'
          : 'Assessment submitted',
      })
    } catch (e) {
      setError(messageOf(e))
      notify({ message: messageOf(e), type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  // Keep refs pointed at the latest handlers for effects/timers
  startRef.current = start
  submitRef.current = submit

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!autoStart || autoStarted.current) return
    autoStarted.current = true
    startRef.current?.()
  }, [autoStart])

  // Countdown timer; auto-submits once when time runs out
  useEffect(() => {
    if (!attempt || !timeLimit || result) return

    const tick = () => {
      const remaining = secondsRemaining(attempt.startedAt, timeLimit)
      setSecondsLeft(remaining)
      if (remaining === 0 && !timeoutSubmitted.current) {
        timeoutSubmitted.current = true
        submitRef.current?.()
      }
    }

    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [attempt, timeLimit, result])

  // ---------------------------------------------------------------------------
  // Result screen
  // ---------------------------------------------------------------------------
  if (result) {
    const passed = result.attempt?.passed

    return (
      <motion.section
        className={`quiz-result ${passed ? 'passed' : 'failed'}`}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div className="result-medal">{passed ? <Trophy size={25} /> : <CircleHelp size={25} />}</div>
        <span className="eyebrow small-eyebrow">ASSESSMENT RESULTS</span>
        <h2>{passed ? 'You passed!' : 'Keep learning and try again'}</h2>
        <div className="score-reveal">
          {Math.round(result.attempt?.scorePercent || 0)}
          <small>%</small>
        </div>
        <p>
          {passed
            ? 'Your course is complete and your certificate has been issued.'
            : 'Review the modules and start another attempt when you are ready.'}
        </p>

        {result.certificate?.certificateNumber && (
          <div className="certificate-number">Certificate {result.certificate.certificateNumber}</div>
        )}

        <button className="button primary" onClick={() => (passed ? onPassed?.(result) : start())}>
          {passed ? 'View my certificates' : 'Start another attempt'} <ArrowRight size={15} />
        </button>

        {error && (
          <div className="form-message" role="alert">
            {error}
          </div>
        )}
      </motion.section>
    )
  }

  // ---------------------------------------------------------------------------
  // Launch screen
  // ---------------------------------------------------------------------------
  if (!attempt) {
    return (
      <section className="quiz-launch">
        <div className="quiz-icon">
          <CircleHelp size={19} />
        </div>
        <div className="grow">
          <b>Course assessment</b>
          <small>Complete the required modules to check your learning.</small>
          {error && <span className="quiz-error">{error}</span>}
        </div>
        <button className="button primary" onClick={start} disabled={busy}>
          {busy ? 'Starting...' : 'Start quiz'} <ArrowRight size={15} />
        </button>
      </section>
    )
  }

  // ---------------------------------------------------------------------------
  // Question screen
  // ---------------------------------------------------------------------------
  const question = questions[step]
  const chosen = answers[question?.id]
  const answered = Array.isArray(chosen) ? chosen.length > 0 : Boolean(chosen)

  return (
    <section className="quiz-flow panel">
      <div className="quiz-topline">
        <span className="eyebrow small-eyebrow">
          QUESTION {step + 1} OF {questions.length}
        </span>
        {timeLimit && (
          <span className="quiz-timer">
            <Clock3 size={13} />
            {Math.floor((secondsLeft ?? 0) / 60)}:{String((secondsLeft ?? 0) % 60).padStart(2, '0')}{' '}
            remaining
          </span>
        )}
      </div>

      <div className="quiz-progress">
        <i style={{ width: `${((step + 1) / questions.length) * 100}%` }} />
      </div>

      {question && (
        <AnimatePresence mode="wait">
          <motion.div
            key={question.id}
            className="quiz-question"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.18 }}
          >
            <h3>{question.text}</h3>
            {question.type === 'multiple_choice' && <p>Select all that apply.</p>}

            <div className="quiz-options">
              {question.options.map(option => {
                const checked = Array.isArray(chosen)
                  ? chosen.includes(option.id)
                  : chosen === option.id

                return (
                  <button
                    key={option.id}
                    className={`quiz-option ${checked ? 'chosen' : ''}`}
                    onClick={() => choose(question, option.id)}
                  >
                    <span className="option-radio">{checked && <Check size={12} />}</span>
                    {option.text}
                  </button>
                )
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {error && (
        <div className="form-message" role="alert">
          {error}
        </div>
      )}

      <div className="quiz-controls">
        <button className="button subtle" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <ArrowLeft size={15} /> Previous
        </button>

        {step < questions.length - 1 ? (
          <button
            className="button primary"
            disabled={!answered}
            onClick={() => setStep(step + 1)}
          >
            Next question <ArrowRight size={15} />
          </button>
        ) : (
          <button className="button primary" disabled={!answered || busy} onClick={submit}>
            {busy ? 'Submitting...' : 'Submit answers'} <Check size={15} />
          </button>
        )}
      </div>
    </section>
  )
}