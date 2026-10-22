import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CirclePlus,
  Link2,
  Plus,
  Trash2,
} from 'lucide-react'
import { api, unwrap } from '../api'
import { messageOf } from '../utils'

const steps = ['Details', 'Modules', 'Assessment', 'Eligibility', 'Review & submit']

const LEVELS = [
  ['new_joiner', 'New joiner'],
  ['junior', 'Junior'],
  ['mid', 'Mid-level'],
  ['senior', 'Senior'],
  ['team_lead', 'Team lead'],
  ['manager', 'Manager'],
]

const blankQuestion = () => ({
  text: '',
  type: 'single_choice',
  marks: 1,
  explanation: '',
  options: [
    { text: '', isCorrect: true },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
  ],
})

const blankModule = () => ({
  title: '',
  type: 'youtube',
  url: '',
  notes: '',
  durationSeconds: '',
  isRequired: true,
})

const firstEligibilityValue = value =>
  Array.isArray(value) ? value[0] || '' : value || ''

export function CourseBuilder({ role, courseId: editCourseId, onClose, onSaved, notify }) {
  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.get('/domains'),
  })
  const domains = Array.isArray(unwrap(domainsQuery.data)) ? unwrap(domainsQuery.data) : []

  const [step, setStep] = useState(0)
  const [course, setCourse] = useState({
    title: '',
    description: '',
    domainId: '',
    isMandatory: false,
    validityMonths: '',
    passMark: 70,
    maxAttempts: 3,
  })
  const [courseId, setCourseId] = useState(editCourseId || '')
  const [modules, setModules] = useState([])
  const [module, setModule] = useState(blankModule())
  const [moduleFile, setModuleFile] = useState(null)
  const [youtubeValid, setYoutubeValid] = useState(false)
  const [validating, setValidating] = useState(false)
  const [questions, setQuestions] = useState([blankQuestion()])
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(30)
  const [shuffleQuestions, setShuffleQuestions] = useState(false)
  const [shuffleOptions, setShuffleOptions] = useState(false)
  const [eligibility, setEligibility] = useState({
    role: '',
    domainId: '',
    level: '',
    designation: '',
    location: '',
  })
  const [saving, setSaving] = useState(false)
  const [loadingCourse, setLoadingCourse] = useState(Boolean(editCourseId))
  const [error, setError] = useState('')

  // ---------------------------------------------------------------------------
  // Load existing course when editing
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!editCourseId) return
    let active = true
    setLoadingCourse(true)

    Promise.all([
      api.get(`/courses/${editCourseId}`),
      api.get(`/courses/${editCourseId}/assessment`).catch(() => null),
    ])
      .then(([courseResult, assessmentResult]) => {
        if (!active) return
        const current = unwrap(courseResult)
        const assessment = unwrap(assessmentResult) || {}

        setCourse({
          title: current.title || '',
          description: current.description || '',
          domainId: current.domainId?._id || current.domainId || '',
          isMandatory: Boolean(current.isMandatory),
          validityMonths: current.validityMonths ?? '',
          passMark: current.passMark ?? 70,
          maxAttempts: current.maxAttempts ?? 3,
        })

        setModules(
          [...(current.modules || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        )

        const currentEligibility = current.eligibility || {}
        setEligibility({
          role: firstEligibilityValue(currentEligibility.roles ?? currentEligibility.role),
          domainId: firstEligibilityValue(
            currentEligibility.domains ?? currentEligibility.domainId,
          ),
          level: firstEligibilityValue(currentEligibility.levels ?? currentEligibility.level),
          designation: firstEligibilityValue(
            currentEligibility.designations ?? currentEligibility.designation,
          ),
          location: firstEligibilityValue(
            currentEligibility.locations ?? currentEligibility.location,
          ),
        })

        if (assessment.questions?.length) {
          setQuestions(
            assessment.questions.map(q => ({
              text: q.text || '',
              type: q.type || 'single_choice',
              marks: q.marks ?? 1,
              explanation: q.explanation || '',
              options: (q.options || []).map(o => ({
                text: o.text || '',
                isCorrect: Boolean(o.isCorrect),
              })),
            })),
          )
        }
        if (assessment.timeLimitMinutes) setTimeLimitMinutes(assessment.timeLimitMinutes)
        setShuffleQuestions(Boolean(assessment.shuffleQuestions))
        setShuffleOptions(Boolean(assessment.shuffleOptions))
        setStep(0)
      })
      .catch(e => {
        if (active) setError(messageOf(e))
      })
      .finally(() => {
        if (active) setLoadingCourse(false)
      })

    return () => {
      active = false
    }
  }, [editCourseId])

  // ---------------------------------------------------------------------------
  // Course details
  // ---------------------------------------------------------------------------
  const setCourseValue = (key, value) => setCourse(prev => ({ ...prev, [key]: value }))

  const saveDetails = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const data = {
        ...course,
        validityMonths: course.validityMonths ? Number(course.validityMonths) : undefined,
        passMark: Number(course.passMark),
        maxAttempts: Number(course.maxAttempts),
      }
      const result = editCourseId
        ? unwrap(await api.patch(`/courses/${editCourseId}`, data))
        : unwrap(await api.post('/courses', data))

      setCourseId(result._id || editCourseId)
      setStep(1)
      notify({ message: editCourseId ? 'Course details updated' : 'Course draft saved' })
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Modules
  // ---------------------------------------------------------------------------
  const validateYouTube = async () => {
    setValidating(true)
    setError('')
    setYoutubeValid(false)
    try {
      await api.post('/modules/validate-youtube', {
        url: module.url,
        title: module.title || undefined,
      })
      setYoutubeValid(true)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setValidating(false)
    }
  }

  const addModule = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const videoId = module.url.match(
        /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/,
      )?.[1]

      const body = { title: module.title, type: module.type, isRequired: module.isRequired }

      if (module.type === 'youtube') {
        Object.assign(body, {
          youtubeVideoId: videoId,
          ...(module.durationSeconds ? { durationSeconds: Number(module.durationSeconds) } : {}),
        })
      }
      if (module.type === 'note') body.notes = module.notes
      if (module.type === 'link') body.sourceUrl = module.url
      if (module.type === 'pdf') {
        const upload = new FormData()
        upload.append('file', moduleFile)
        const stored = unwrap(await api.post(`/courses/${courseId}/uploads`, upload))
        body.uploadId = stored.id
      }

      const created = unwrap(await api.post(`/courses/${courseId}/modules`, body))
      setModules(prev => [...prev, { ...body, ...created }])
      setModule(blankModule())
      setModuleFile(null)
      setYoutubeValid(false)
      notify({ message: 'Module added to the draft' })
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  const removeModule = async item => {
    if (!item._id) return
    try {
      await api.delete(`/courses/${courseId}/modules/${item._id}`)
      setModules(prev => prev.filter(x => x._id !== item._id))
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const reorderModules = async (index, delta) => {
    const next = [...modules]
    const target = index + delta
    if (target < 0 || target >= next.length || next.some(item => !item._id)) return
    ;[next[index], next[target]] = [next[target], next[index]]

    setSaving(true)
    setError('')
    try {
      await api.patch(`/courses/${courseId}/modules/reorder`, {
        order: next.map(item => item._id),
      })
      setModules(next)
      notify({ message: 'Module order updated' })
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Assessment
  // ---------------------------------------------------------------------------
  const saveAssessment = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await api.put(`/courses/${courseId}/assessment`, {
        questions: questions.map(({ text, type, marks, explanation, options }) => ({
          text: text.trim(),
          type,
          marks: Number(marks),
          explanation,
          options: options.map(o => ({ text: o.text.trim(), isCorrect: Boolean(o.isCorrect) })),
        })),
        timeLimitMinutes: Number(timeLimitMinutes),
        shuffleQuestions,
        shuffleOptions,
      })
      setStep(3)
      notify({ message: 'Assessment saved' })
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  const updateQuestion = (index, patch) =>
    setQuestions(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  const updateOption = (questionIndex, optionIndex, patch) =>
    setQuestions(prev =>
      prev.map((item, i) =>
        i === questionIndex
          ? {
              ...item,
              options: item.options.map((option, j) =>
                j === optionIndex ? { ...option, ...patch } : option,
              ),
            }
          : item,
      ),
    )

  const toggleCorrect = (questionIndex, optionIndex, checked) => {
    const current = questions[questionIndex]
    if (current.type === 'multiple_choice') {
      updateOption(questionIndex, optionIndex, { isCorrect: checked })
    } else {
      setQuestions(prev =>
        prev.map((item, i) =>
          i === questionIndex
            ? {
                ...item,
                options: item.options.map((option, j) => ({
                  ...option,
                  isCorrect: j === optionIndex,
                })),
              }
            : item,
        ),
      )
    }
  }

  const changeQuestionType = (questionIndex, type) =>
    setQuestions(prev =>
      prev.map((item, i) => {
        if (i !== questionIndex) return item

        const firstCorrect = item.options.findIndex(option => option.isCorrect)

        if (type === 'true_false') {
          return {
            ...item,
            type,
            options: [
              { text: 'True', isCorrect: firstCorrect <= 0 },
              { text: 'False', isCorrect: firstCorrect === 1 },
            ],
          }
        }

        if (item.type === 'true_false') {
          return {
            ...item,
            type,
            options: ['', '', '', ''].map((_, index) => ({
              text: `Option ${index + 1}`,
              isCorrect: index === Math.max(0, firstCorrect),
            })),
          }
        }

        return {
          ...item,
          type,
          ...(type === 'multiple_choice'
            ? {}
            : {
                options: item.options.map((option, index) => ({
                  ...option,
                  isCorrect: index === firstCorrect,
                })),
              }),
        }
      }),
    )

  const moveQuestion = (index, delta) =>
    setQuestions(prev => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  // ---------------------------------------------------------------------------
  // Eligibility & submit
  // ---------------------------------------------------------------------------
  const saveEligibility = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const payload = {
        ...(eligibility.role ? { roles: [eligibility.role] } : {}),
        ...(eligibility.domainId ? { domains: [eligibility.domainId] } : {}),
        ...(eligibility.level ? { levels: [eligibility.level] } : {}),
        ...(eligibility.designation.trim()
          ? { designations: [eligibility.designation.trim()] }
          : {}),
        ...(eligibility.location.trim() ? { locations: [eligibility.location.trim()] } : {}),
      }
      await api.patch(`/courses/${courseId}`, { eligibility: payload })
      setStep(4)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  const submitForReview = async () => {
    setSaving(true)
    setError('')
    try {
      if (role === 'trainer') await api.post(`/courses/${courseId}/submit`)
      notify({ message: role === 'trainer' ? 'Course sent for review' : 'Course draft saved' })
      onSaved()
      onClose()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loadingCourse) {
    return (
      <div className="builder-stage">
        <div className="table-skeleton" />
        <p>Loading course details…</p>
      </div>
    )
  }

  return (
    <div className="builder">
      <div className="builder-progress">
        {steps.map((label, index) => (
          <button
            type="button"
            key={label}
            className={`builder-step ${step === index ? 'active' : ''} ${step > index ? 'done' : ''}`}
            onClick={() => index < step && setStep(index)}
          >
            <span>{step > index ? <Check size={12} /> : index + 1}</span>
            <b>{label}</b>
          </button>
        ))}
      </div>

      {error && (
        <div className="form-message" role="alert">
          {error}
        </div>
      )}

      {/* Step 0 — Details */}
      {step === 0 && (
        <form className="modal-form" onSubmit={saveDetails}>
          <div className="builder-intro">
            <h3>Course details</h3>
            <p>Start with a clear title and the domain this course serves.</p>
          </div>

          <label>
            Course title
            <input
              autoFocus
              maxLength="200"
              required
              value={course.title}
              onChange={e => setCourseValue('title', e.target.value)}
              placeholder="e.g. Secure software fundamentals"
            />
          </label>

          <label>
            Domain
            <select
              required
              value={course.domainId}
              onChange={e => setCourseValue('domainId', e.target.value)}
            >
              <option value="">Choose a domain</option>
              {domains.map(d => (
                <option value={d._id} key={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
            {domainsQuery.error && (
              <small className="field-error">Could not load domains. Refresh and try again.</small>
            )}
          </label>

          <label>
            Description
            <textarea
              maxLength="5000"
              rows="3"
              value={course.description}
              onChange={e => setCourseValue('description', e.target.value)}
              placeholder="What will learners be able to do?"
            />
          </label>

          <div className="form-pair">
            <label>
              Certificate validity (months)
              <input
                type="number"
                min="1"
                value={course.validityMonths}
                onChange={e => setCourseValue('validityMonths', e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label>
              Pass mark (%)
              <input
                type="number"
                min="0"
                max="100"
                value={course.passMark}
                onChange={e => setCourseValue('passMark', e.target.value)}
              />
            </label>
          </div>

          <label className="check-label">
            <input
              type="checkbox"
              checked={course.isMandatory}
              onChange={e => setCourseValue('isMandatory', e.target.checked)}
            />{' '}
            Required for assigned learners
          </label>

          <div className="modal-actions">
            <button className="button primary" disabled={saving || domainsQuery.isLoading}>
              {saving ? 'Saving...' : 'Save and add modules'}
              <ArrowRight size={15} />
            </button>
          </div>
        </form>
      )}

      {/* Step 1 — Modules */}
      {step === 1 && (
        <div className="builder-stage">
          <div className="builder-intro">
            <h3>Build the course outline</h3>
            <p>Add YouTube, PDF, reading or link modules. Each module saves to your draft.</p>
          </div>

          {modules.map((item, index) => (
            <div className="builder-module" key={item._id || `${item.title}-${index}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div className="grow">
                <b>{item.title}</b>
                <small>{item.type}</small>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={`Move ${item.title} up`}
                disabled={saving || index === 0}
                onClick={() => reorderModules(index, -1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Move ${item.title} down`}
                disabled={saving || index === modules.length - 1}
                onClick={() => reorderModules(index, 1)}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${item.title}`}
                onClick={() => removeModule(item)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}

          <form className="builder-add-module" onSubmit={addModule}>
            <div className="form-pair">
              <label>
                Module type
                <select
                  value={module.type}
                  onChange={e => {
                    setModule(prev => ({ ...prev, type: e.target.value }))
                    setYoutubeValid(false)
                  }}
                >
                  <option value="youtube">YouTube video</option>
                  <option value="pdf">PDF file</option>
                  <option value="note">Reading note</option>
                  <option value="link">External link</option>
                </select>
              </label>
              <label>
                Module title
                <input
                  required
                  maxLength="200"
                  value={module.title}
                  onChange={e => setModule(prev => ({ ...prev, title: e.target.value }))}
                />
              </label>
            </div>

            {module.type === 'youtube' && (
              <>
                <label>
                  YouTube URL
                  <div className="inline-input">
                    <input
                      type="url"
                      required
                      value={module.url}
                      onChange={e => {
                        setModule(prev => ({ ...prev, url: e.target.value }))
                        setYoutubeValid(false)
                      }}
                      placeholder="https://www.youtube.com/watch?v=..."
                    />
                    <button
                      type="button"
                      className="button outline"
                      onClick={validateYouTube}
                      disabled={validating || !module.url}
                    >
                      <Link2 size={14} />
                      {validating ? 'Checking...' : youtubeValid ? 'Available' : 'Validate'}
                    </button>
                  </div>
                </label>
                <label>
                  Duration in seconds
                  <input
                    type="number"
                    min="1"
                    value={module.durationSeconds}
                    onChange={e =>
                      setModule(prev => ({ ...prev, durationSeconds: e.target.value }))
                    }
                  />
                </label>
              </>
            )}

            {module.type === 'pdf' && (
              <label className="file-picker">
                PDF lesson file
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  required
                  onChange={e => setModuleFile(e.target.files?.[0] || null)}
                />
                <small>{moduleFile?.name || 'Choose a PDF, up to the backend upload limit'}</small>
              </label>
            )}

            {module.type === 'note' && (
              <label>
                Reading content
                <textarea
                  rows="4"
                  required
                  maxLength="10000"
                  value={module.notes}
                  onChange={e => setModule(prev => ({ ...prev, notes: e.target.value }))}
                />
              </label>
            )}

            {module.type === 'link' && (
              <label>
                HTTPS link
                <input
                  type="url"
                  required
                  value={module.url}
                  onChange={e => setModule(prev => ({ ...prev, url: e.target.value }))}
                />
              </label>
            )}

            <label className="check-label">
              <input
                type="checkbox"
                checked={module.isRequired}
                onChange={e => setModule(prev => ({ ...prev, isRequired: e.target.checked }))}
              />{' '}
              Required module
            </label>

            <button
              className="button outline"
              disabled={
                saving ||
                (module.type === 'youtube' && !youtubeValid) ||
                (module.type === 'pdf' && !moduleFile)
              }
            >
              <CirclePlus size={15} />
              {saving ? 'Adding...' : 'Add module'}
            </button>
          </form>

          <div className="builder-actions">
            <button className="button subtle" onClick={() => setStep(0)}>
              <ArrowLeft size={15} /> Details
            </button>
            <button
              className="button primary"
              disabled={!modules.length}
              onClick={() => setStep(2)}
            >
              Assessment <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Assessment */}
      {step === 2 && (
        <form className="modal-form" onSubmit={saveAssessment}>
          <div className="builder-intro">
            <h3>Assessment builder</h3>
            <p>Add and arrange questions, answers and feedback for the course assessment.</p>
          </div>

          {questions.map((question, questionIndex) => (
            <section className="panel assessment-question" key={questionIndex}>
              <div className="builder-module">
                <b>Question {questionIndex + 1}</b>
                <span className="grow" />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move question ${questionIndex + 1} up`}
                  disabled={questionIndex === 0}
                  onClick={() => moveQuestion(questionIndex, -1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move question ${questionIndex + 1} down`}
                  disabled={questionIndex === questions.length - 1}
                  onClick={() => moveQuestion(questionIndex, 1)}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Delete question ${questionIndex + 1}`}
                  disabled={questions.length === 1}
                  onClick={() => setQuestions(prev => prev.filter((_, i) => i !== questionIndex))}
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <label>
                Question
                <input
                  required
                  maxLength="2000"
                  value={question.text}
                  onChange={e => updateQuestion(questionIndex, { text: e.target.value })}
                  placeholder="Write a question"
                />
              </label>

              <label>
                Question type
                <select
                  value={question.type}
                  onChange={e => changeQuestionType(questionIndex, e.target.value)}
                >
                  <option value="single_choice">Single choice</option>
                  <option value="multiple_choice">Multiple choice</option>
                  <option value="true_false">True or false</option>
                </select>
              </label>

              <label>Answer options</label>
              {question.options.map((option, optionIndex) => (
                <div className="option-row" key={optionIndex}>
                  <input
                    required
                    maxLength="500"
                    value={option.text}
                    onChange={e => updateOption(questionIndex, optionIndex, { text: e.target.value })}
                    placeholder={`Option ${optionIndex + 1}`}
                  />
                  <label className="correct-option">
                    <input
                      type={question.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                      name={`correct-${questionIndex}`}
                      checked={option.isCorrect}
                      onChange={e => toggleCorrect(questionIndex, optionIndex, e.target.checked)}
                    />{' '}
                    Correct
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove option ${optionIndex + 1}`}
                    disabled={question.options.length <= 2}
                    onClick={() =>
                      updateQuestion(questionIndex, {
                        options: question.options.filter((_, i) => i !== optionIndex),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="text-button"
                disabled={question.options.length >= 10}
                onClick={() =>
                  updateQuestion(questionIndex, {
                    options: [...question.options, { text: '', isCorrect: false }],
                  })
                }
              >
                <Plus size={14} /> Add option
              </button>

              <div className="form-pair">
                <label>
                  Points
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={question.marks}
                    onChange={e => updateQuestion(questionIndex, { marks: e.target.value })}
                  />
                </label>
                <label>
                  Explanation (optional)
                  <textarea
                    rows="2"
                    value={question.explanation}
                    onChange={e => updateQuestion(questionIndex, { explanation: e.target.value })}
                  />
                </label>
              </div>

              {!question.options.some(option => option.isCorrect) && (
                <small className="field-error">Select at least one correct answer.</small>
              )}
            </section>
          ))}

          <button
            type="button"
            className="button outline"
            disabled={questions.length >= 50}
            onClick={() => setQuestions(prev => [...prev, blankQuestion()])}
          >
            <Plus size={15} /> Add question
          </button>

          <div className="form-pair">
            <label>
              Time limit (minutes)
              <input
                type="number"
                min="1"
                max="300"
                value={timeLimitMinutes}
                onChange={e => setTimeLimitMinutes(e.target.value)}
              />
            </label>
            <span />
          </div>

          <label className="check-label">
            <input
              type="checkbox"
              checked={shuffleQuestions}
              onChange={e => setShuffleQuestions(e.target.checked)}
            />{' '}
            Shuffle questions
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={shuffleOptions}
              onChange={e => setShuffleOptions(e.target.checked)}
            />{' '}
            Shuffle answer options
          </label>

          <div className="modal-actions">
            <button type="button" className="button subtle" onClick={() => setStep(1)}>
              <ArrowLeft size={15} /> Modules
            </button>
            <button
              className="button primary"
              disabled={saving || questions.some(q => !q.options.some(o => o.isCorrect))}
            >
              {saving ? 'Saving...' : 'Save assessment'}
              <ArrowRight size={15} />
            </button>
          </div>
        </form>
      )}

      {/* Step 3 — Eligibility */}
      {step === 3 && (
        <form className="modal-form" onSubmit={saveEligibility}>
          <div className="builder-intro">
            <h3>Who can take this course?</h3>
            <p>
              Leave a field set to “Any” to include everyone assigned to the course. These filters
              use readable options; database IDs stay behind the scenes.
            </p>
          </div>

          <div className="form-pair">
            <label>
              Role
              <select
                value={eligibility.role}
                onChange={e => setEligibility(prev => ({ ...prev, role: e.target.value }))}
              >
                <option value="">Any role</option>
                <option value="employee">Employee</option>
                <option value="trainer">Trainer</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
            <label>
              Domain
              <select
                value={eligibility.domainId}
                onChange={e => setEligibility(prev => ({ ...prev, domainId: e.target.value }))}
              >
                <option value="">Any domain</option>
                {domains.map(domain => (
                  <option key={domain._id} value={domain._id}>
                    {domain.name}
                  </option>
                ))}
              </select>
              {domainsQuery.error && <small className="field-error">Could not load domains.</small>}
            </label>
          </div>

          <div className="form-pair">
            <label>
              Level
              <select
                value={eligibility.level}
                onChange={e => setEligibility(prev => ({ ...prev, level: e.target.value }))}
              >
                <option value="">Any level</option>
                {LEVELS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Designation
              <input
                value={eligibility.designation}
                onChange={e => setEligibility(prev => ({ ...prev, designation: e.target.value }))}
                placeholder="Any designation"
                maxLength="120"
              />
            </label>
          </div>

          <label>
            Location
            <input
              value={eligibility.location}
              onChange={e => setEligibility(prev => ({ ...prev, location: e.target.value }))}
              placeholder="Any location"
              maxLength="100"
            />
          </label>

          <div className="field-hint">
            Age filters aren’t available because employee profiles don’t include date of birth.
          </div>

          <div className="modal-actions">
            <button type="button" className="button subtle" onClick={() => setStep(2)}>
              <ArrowLeft size={15} /> Assessment
            </button>
            <button className="button primary" disabled={saving || domainsQuery.isLoading}>
              {saving ? 'Saving...' : 'Save & review'}
              <ArrowRight size={15} />
            </button>
          </div>
        </form>
      )}

      {/* Step 4 — Review & submit */}
      {step === 4 && (
        <div className="builder-stage">
          <div className="builder-intro">
            <h3>{role === 'trainer' ? 'Ready for review?' : 'Draft course saved'}</h3>
            <p>
              {role === 'trainer'
                ? 'Your course is saved as a draft. Submission sends it to an administrator for approval.'
                : 'Your course draft is ready. A trainer can continue editing and submit it for approval.'}
            </p>
          </div>

          <div className="review-summary">
            <div>
              <span>Course</span>
              <b>{course.title}</b>
            </div>
            <div>
              <span>Modules</span>
              <b>{modules.length} learning modules</b>
            </div>
            <div>
              <span>Assessment</span>
              <b>{questions.length} questions</b>
            </div>
            <div>
              <span>Pass mark</span>
              <b>{course.passMark}%</b>
            </div>
          </div>

          <div className="builder-actions">
            <button className="button subtle" onClick={() => setStep(3)}>
              <ArrowLeft size={15} /> Eligibility
            </button>
            <button className="button primary" disabled={saving} onClick={submitForReview}>
              {saving ? 'Saving...' : role === 'trainer' ? 'Submit for review' : 'Finish draft'}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}