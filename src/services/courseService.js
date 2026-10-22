import {
  Assessment,
  Assignment,
  AssignmentRule,
  Attempt,
  AuditLog,
  Certificate,
  Course,
  ModuleProgress,
  Domain,
  Notification,
  ReminderLog,
  Upload,
} from '../models/index.js';
import { localUploadStorage } from './uploadStorage.js';
import { AppError } from '../utils/AppError.js';

const sanitizeHtml = process
  .getBuiltinModule('module')
  .createRequire(import.meta.url)('sanitize-html');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Course fields a trainer may change on a draft
const editable = [
  'title',
  'description',
  'domainId',
  'isMandatory',
  'validityMonths',
  'passMark',
  'maxAttempts',
  'estimatedMinutes',
  'tags',
  'eligibility',
];

// Review workflow: which states each action may start from, and where it ends
const allowedTransitions = {
  submit: { from: ['draft', 'rejected'], to: 'under_review' },
  approve: { from: ['under_review'], to: 'published' },
  reject: { from: ['under_review'], to: 'rejected' },
  archive: { from: ['published'], to: 'archived' },
};

const noteSanitizerOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['https', 'http', 'mailto'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sanitizeNotes = (notes) => sanitizeHtml(notes, noteSanitizerOptions);

const trainerHasDomain = (actor, domainId) =>
  (actor.trainerDomains || []).some((x) => String(x) === String(domainId));

// True when a trainer is looking at a course they don't own or whose domain isn't theirs
const isForeignTrainerCourse = (actor, course) =>
  actor.role === 'trainer' &&
  (String(course.trainerId) !== String(actor._id) ||
    !trainerHasDomain(actor, course.domainId));

export function assertTrainerDomain(actor, domainId) {
  if (actor.role === 'trainer' && !trainerHasDomain(actor, domainId)) {
    throw new AppError(403, 'Forbidden', 'FORBIDDEN');
  }
}

// Copy the assessment from one course to another (creating it if needed)
async function copyAssessment(fromCourseId, toCourseId) {
  const source = await Assessment.findOne({ courseId: fromCourseId });
  if (!source) return;

  await Assessment.updateOne(
    { courseId: toCourseId },
    {
      $set: {
        questions: source.questions,
        timeLimitMinutes: source.timeLimitMinutes,
        shuffleQuestions: source.shuffleQuestions,
        shuffleOptions: source.shuffleOptions,
      },
    },
    { upsert: true }
  );
}

// Record the version creation once, even if the request is retried
async function logVersionCreated(course, version, actor) {
  await AuditLog.updateOne(
    {
      entityType: 'Course',
      entityId: version._id,
      action: 'course.version.create',
    },
    {
      $setOnInsert: {
        actorId: actor._id,
        before: { version: course.version },
        after: { version: version.version, status: 'draft' },
      },
    },
    { upsert: true }
  );
}

// ---------------------------------------------------------------------------
// Course lookup and updates
// ---------------------------------------------------------------------------

export async function findCourse(id, actor, { write = false } = {}) {
  const c = await Course.findById(id);
  if (!c) throw new AppError(404, 'Course not found', 'NOT_FOUND');

  if (isForeignTrainerCourse(actor, c)) {
    throw new AppError(404, 'Course not found', 'NOT_FOUND');
  }

  if (actor.role === 'employee') {
    throw new AppError(403, 'Forbidden', 'FORBIDDEN');
  }

  if (write && actor.role === 'admin') {
    throw new AppError(
      403,
      'Only the course trainer can edit course content',
      'FORBIDDEN'
    );
  }

  if (write && !['draft', 'rejected'].includes(c.status)) {
    throw new AppError(
      422,
      'Course is immutable in its current state; create a new version',
      'INVALID_TRANSITION'
    );
  }

  return c;
}

export async function updateCourse(id, body, actor) {
  const c = await findCourse(id, actor, { write: true });

  if (body.domainId) assertTrainerDomain(actor, body.domainId);

  if (
    body.domainId &&
    !(await Domain.exists({ _id: body.domainId, isActive: true }))
  ) {
    throw new AppError(422, 'Active domain required', 'INVALID_DOMAIN');
  }

  const before = { title: c.title, domainId: c.domainId, status: c.status };

  for (const key of editable) {
    if (body[key] !== undefined) c[key] = body[key];
  }
  await c.save();

  await AuditLog.create({
    actorId: actor._id,
    action: 'course.update',
    entityType: 'Course',
    entityId: c._id,
    before,
    after: { title: c.title, domainId: c.domainId, status: c.status },
  });

  return c;
}

// ---------------------------------------------------------------------------
// Review workflow
// ---------------------------------------------------------------------------

export async function transitionCourse(id, action, actor, notes) {
  const rule = allowedTransitions[action];
  if (!rule) {
    throw new AppError(422, 'Invalid course transition', 'INVALID_TRANSITION');
  }

  // The update only matches if the course is still in an allowed starting state
  const filter = { _id: id, status: { $in: rule.from } };
  if (action === 'submit' && actor.role === 'trainer') {
    filter.trainerId = actor._id;
  }
  if (action === 'archive' && actor.role === 'trainer') {
    filter.trainerId = actor._id;
  }

  const current = await Course.findById(id);
  if (!current) throw new AppError(404, 'Course not found', 'NOT_FOUND');

  if (isForeignTrainerCourse(actor, current)) {
    throw new AppError(404, 'Course not found', 'NOT_FOUND');
  }

  if (action === 'approve' && String(current.trainerId) === String(actor._id)) {
    throw new AppError(403, 'Cannot approve your own course', 'FORBIDDEN');
  }

  // A course can only be submitted once it has modules, an assessment and eligibility
  if (
    action === 'submit' &&
    (!current.modules.length ||
      !(await Assessment.exists({ courseId: id })) ||
      !current.eligibility ||
      typeof current.eligibility !== 'object' ||
      !Object.keys(current.eligibility).length)
  ) {
    throw new AppError(
      422,
      'Course requires modules, assessment, and eligibility',
      'COURSE_INCOMPLETE'
    );
  }

  const set = { status: rule.to };
  if (action === 'approve') {
    set.approvedBy = actor._id;
    set.publishedAt = new Date();
  }
  if (action === 'reject') set.reviewNotes = notes;

  const updated = await Course.findOneAndUpdate(
    filter,
    { $set: set },
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw new AppError(
      422,
      `Cannot ${action} course from ${current.status}`,
      'INVALID_TRANSITION'
    );
  }

  await AuditLog.create({
    actorId: actor._id,
    action: `course.${action}`,
    entityType: 'Course',
    entityId: updated._id,
    before: { status: current.status },
    after: { status: updated.status, ...(notes ? { notes } : {}) },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

export async function newVersion(id, actor) {
  const c = await Course.findById(id);
  if (!c) throw new AppError(404, 'Course not found', 'NOT_FOUND');

  if (isForeignTrainerCourse(actor, c)) {
    throw new AppError(404, 'Course not found', 'NOT_FOUND');
  }

  if (c.status !== 'published' && c.status !== 'archived') {
    throw new AppError(
      422,
      'Only a published course can be versioned',
      'INVALID_TRANSITION'
    );
  }

  // The next version may already exist (e.g. a retried request): reuse it
  const existing = await Course.findOne({
    versionOf: c._id,
    version: c.version + 1,
  });
  if (existing) {
    await copyAssessment(c._id, existing._id);
    await logVersionCreated(c, existing, actor);
    return existing;
  }

  // Copy modules without their ids so the new version gets fresh ones
  const modules = c.modules.map((m) => {
    const x = m.toObject();
    delete x._id;
    return x;
  });

  let version;
  try {
    version = await Course.create({
      title: c.title,
      description: c.description,
      domainId: c.domainId,
      trainerId: c.trainerId,
      version: c.version + 1,
      versionOf: c._id,
      status: 'draft',
      isMandatory: c.isMandatory,
      validityMonths: c.validityMonths,
      passMark: c.passMark,
      maxAttempts: c.maxAttempts,
      estimatedMinutes: c.estimatedMinutes,
      tags: c.tags,
      eligibility: c.eligibility,
      modules,
    });
  } catch (error) {
    // Two requests raced to create the same version: use the one that won
    if (error.code === 11000) {
      version = await Course.findOne({
        versionOf: c._id,
        version: c.version + 1,
      });
      if (!version) throw error;
    } else {
      throw error;
    }
  }

  await copyAssessment(c._id, version._id);
  await logVersionCreated(c, version, actor);

  return version;
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

export async function deleteCourse(id, actor) {
  const removed = await Course.findById(id);
  if (!removed) throw new AppError(404, 'Course not found', 'NOT_FOUND');

  if (actor.role === 'trainer') {
    if (isForeignTrainerCourse(actor, removed)) {
      throw new AppError(404, 'Course not found', 'NOT_FOUND');
    }
    if (removed.status !== 'draft') {
      throw new AppError(
        422,
        'Trainers can delete draft courses only',
        'INVALID_TRANSITION'
      );
    }
  }

  const assignmentIds = await Assignment.find({ courseId: id }).distinct('_id');

  const [certificateIds, uploads] = await Promise.all([
    Certificate.find({
      $or: [{ courseId: id }, { assignmentId: { $in: assignmentIds } }],
    }).distinct('_id'),
    Upload.find({ courseId: id }).select('storageName').lean(),
  ]);

  // Log first, so the deletion is recorded even if cleanup fails part-way
  await AuditLog.create({
    actorId: actor._id,
    action: 'course.delete',
    entityType: 'Course',
    entityId: removed._id,
    before: {
      title: removed.title,
      status: removed.status,
      assignmentCount: assignmentIds.length,
    },
  });

  // Remove stored files, then every record tied to the course
  await Promise.all(
    uploads.map((upload) => localUploadStorage.delete(upload.storageName))
  );

  await Promise.all([
    Assignment.deleteMany({ courseId: id }),
    Assessment.deleteMany({ courseId: id }),
    Attempt.deleteMany({ courseId: id }),
    ModuleProgress.deleteMany({ courseId: id }),
    Certificate.deleteMany({
      $or: [{ courseId: id }, { assignmentId: { $in: assignmentIds } }],
    }),
    AssignmentRule.updateMany({ courseId: id }, { $set: { isActive: false } }),
    Upload.deleteMany({ courseId: id }),
    Notification.deleteMany({
      link: { $regex: `/courses/${String(id)}(?:$|[/?#])` },
    }),
    ReminderLog.deleteMany({
      $or: [
        { assignmentId: { $in: assignmentIds } },
        { certificateId: { $in: certificateIds } },
      ],
    }),
  ]);

  await Course.deleteOne({ _id: id });
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export async function addModule(id, body, actor) {
  const c = await findCourse(id, actor, { write: true });

  const module = {
    title: body.title,
    type: body.type,
    order: c.modules.length,
    completionThreshold: body.completionThreshold ?? 90,
    isRequired: body.isRequired ?? true,
  };

  if (body.type === 'youtube') {
    module.youtubeVideoId = body.youtubeVideoId;
    module.durationSeconds = body.durationSeconds;
  }
  if (body.type === 'pdf') module.uploadId = body.uploadId;
  if (body.type === 'note') module.notes = sanitizeNotes(body.notes);
  if (body.type === 'link') module.sourceUrl = body.sourceUrl;

  c.modules.push(module);
  await c.save();

  const created = c.modules.at(-1);

  await AuditLog.create({
    actorId: actor._id,
    action: 'course.module.create',
    entityType: 'Course',
    entityId: c._id,
    after: { moduleId: created._id, title: created.title, type: created.type },
  });

  return created;
}

export async function patchModule(id, moduleId, body, actor) {
  const c = await findCourse(id, actor, { write: true });
  const m = c.modules.id(moduleId);
  if (!m) throw new AppError(404, 'Module not found', 'NOT_FOUND');

  for (const key of [
    'title',
    'type',
    'youtubeVideoId',
    'sourceUrl',
    'uploadId',
    'durationSeconds',
    'completionThreshold',
    'isRequired',
  ]) {
    if (body[key] !== undefined) m[key] = body[key];
  }

  if (body.notes !== undefined) m.notes = sanitizeNotes(body.notes);

  await c.save();

  await AuditLog.create({
    actorId: actor._id,
    action: 'course.module.update',
    entityType: 'Course',
    entityId: c._id,
    after: { moduleId: m._id, title: m.title, type: m.type },
  });

  return m;
}

export async function reorderModules(id, order, actor) {
  const c = await findCourse(id, actor, { write: true });
  const ids = c.modules.map((m) => String(m._id));

  // The new order must list every module exactly once
  if (
    order.length !== ids.length ||
    new Set(order).size !== ids.length ||
    ids.some((x) => !order.includes(x))
  ) {
    throw new AppError(
      422,
      'order must contain every module ID exactly once',
      'INVALID_ORDER'
    );
  }

  c.modules.sort(
    (a, b) => order.indexOf(String(a._id)) - order.indexOf(String(b._id))
  );
  c.modules.forEach((m, i) => (m.order = i));
  await c.save();

  await AuditLog.create({
    actorId: actor._id,
    action: 'course.module.reorder',
    entityType: 'Course',
    entityId: c._id,
    after: { order },
  });

  return c.modules;
}

export async function removeModule(id, moduleId, actor) {
  const c = await findCourse(id, actor, { write: true });

  if (!c.modules.id(moduleId)) {
    throw new AppError(404, 'Module not found', 'NOT_FOUND');
  }

  c.modules.pull({ _id: moduleId });
  c.modules.forEach((m, i) => (m.order = i));
  await c.save();

  await AuditLog.create({
    actorId: actor._id,
    action: 'course.module.delete',
    entityType: 'Course',
    entityId: c._id,
    before: { moduleId },
  });

  return c;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export async function putAssessment(id, body, actor) {
  await findCourse(id, actor, { write: true });

  const questions = body.questions.map((q) => ({
    ...q,
    options: q.options.map((o) => ({ ...o })),
  }));

  const fields = {
    questions,
    timeLimitMinutes: body.timeLimitMinutes,
    shuffleQuestions: body.shuffleQuestions,
    shuffleOptions: body.shuffleOptions,
  };

  let result;
  try {
    result = await Assessment.findOneAndUpdate(
      { courseId: id },
      { $set: fields },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;

    // Two saves raced on the upsert: retry as a plain update
    result = await Assessment.findOneAndUpdate(
      { courseId: id },
      { $set: fields },
      { new: true, runValidators: true }
    );
  }

  await AuditLog.create({
    actorId: actor._id,
    action: 'course.assessment.update',
    entityType: 'Course',
    entityId: id,
    after: { questionCount: questions.length },
  });

  return result;
}

export async function getAssessment(id, actor) {
  await findCourse(id, actor);

  const assessment = await Assessment.findOne({ courseId: id });
  if (!assessment) throw new AppError(404, 'Assessment not found', 'NOT_FOUND');

  return assessment;
}