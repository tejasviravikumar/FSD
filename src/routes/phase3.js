import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  Assignment,
  AssignmentRule,
  AuditLog,
  Course,
  ModuleProgress,
  User,
} from '../models/index.js';
import { authenticate, allow } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import * as service from '../services/phase3Service.js';

const r = Router();

const ok = (res, data, message = 'OK', meta = {}) =>
  res.json({ success: true, data, message, meta });

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const oid = z.string().regex(/^[a-f\d]{24}$/i);
const idParams = z.object({ id: oid }).strict();
const moduleParams = z.object({ id: oid, moduleId: oid }).strict();
const body = (schema) => validate({ body: schema });
const params = (schema) => validate({ params: schema });

const condition = z
  .object({
    field: z.enum([
      'domainId',
      'designation',
      'level',
      'location',
      'joinedWithinDays',
      'tag',
    ]),
    operator: z.enum(['eq', 'in', 'not_in', 'gte', 'lte']),
    value: z.union([
      z.string().max(120),
      z.number(),
      z.array(z.union([z.string().max(120), z.number()])).min(1).max(100),
    ]),
  })
  .strict();

const recurrence = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('annual') }).strict(),
  z
    .object({
      type: z.literal('custom'),
      months: z.number().int().min(1).max(120),
    })
    .strict(),
]);

const ruleInput = z
  .object({
    name: z.string().min(1).max(120),
    courseId: oid,
    isActive: z.boolean().optional(),
    conditions: z.array(condition).min(1).max(20),
    matchType: z.enum(['all', 'any']).default('all'),
    recurrence: recurrence.default({ type: 'none' }),
    dueInDays: z.number().int().min(0).max(3650).optional(),
  })
  .strict();

const rulePatch = z
  .object({
    name: z.string().min(1).max(120).optional(),
    courseId: oid.optional(),
    isActive: z.boolean().optional(),
    conditions: z.array(condition).min(1).max(20).optional(),
    matchType: z.enum(['all', 'any']).optional(),
    recurrence: recurrence.optional(),
    dueInDays: z.number().int().min(0).max(3650).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z
      .enum([
        'not_started',
        'in_progress',
        'completed',
        'overdue',
        'expired',
        'cancelled',
      ])
      .optional(),
    dueBefore: z.coerce.date().optional(),
    employeeId: oid.optional(),
    courseId: oid.optional(),
    domainId: oid.optional(),
    overdue: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();

const patchAssignment = z
  .object({
    dueDate: z.string().datetime({ offset: true }).nullable().optional(),
    cancel: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => Object.keys(v).length > 0 && !(v.cancel && v.dueDate !== undefined),
    { message: 'Supply dueDate or cancel' }
  );

const createAssignmentInput = z
  .object({
    courseId: oid,
    employeeId: oid.optional(),
    employeeIds: z.array(oid).min(1).max(1000).optional(),
    filter: z
      .object({
        domainId: oid.optional(),
        designation: z.string().max(120).optional(),
        level: z.string().max(30).optional(),
        location: z.string().max(100).optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, {
        message: 'filter must contain at least one condition',
      })
      .optional(),
    dueDate: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.employeeId) || Boolean(v.employeeIds) || Boolean(v.filter), {
    message: 'employeeId, employeeIds or filter is required',
  })
  .refine(
    (v) =>
      Number(Boolean(v.employeeId)) +
        Number(Boolean(v.employeeIds)) +
        Number(Boolean(v.filter)) ===
      1,
    { message: 'Choose only one employee selector' }
  );

const progressInput = z
  .object({
    watchedSeconds: z.number().finite().min(0),
    lastPositionSeconds: z.number().finite().min(0),
    durationSeconds: z.number().finite().positive().max(86400),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Load an assignment, hiding it (404) from anyone who shouldn't see it
const assignmentFor = async (id, actor) => {
  const a = await Assignment.findById(id).populate('courseId');
  if (!a) throw new AppError(404, 'Assignment not found', 'NOT_FOUND');

  // Plain employees may only see their own assignments
  if (
    actor.role === 'employee' &&
    !actor.isManager &&
    String(a.employeeId) !== String(actor._id)
  ) {
    throw new AppError(404, 'Assignment not found', 'NOT_FOUND');
  }

  // Managers may see their own and their direct reports' assignments
  if (
    actor.role === 'employee' &&
    actor.isManager &&
    String(a.employeeId) !== String(actor._id) &&
    !(await User.exists({
      _id: a.employeeId,
      managerId: actor._id,
      status: 'active',
      deletedAt: null,
    }))
  ) {
    throw new AppError(404, 'Assignment not found', 'NOT_FOUND');
  }

  return a;
};

// Build the Mongo filter for the assignment list, scoped to what the actor may see
const scopeAssignmentQuery = async (q, actor) => {
  const f = {};
  const and = [];

  if (actor.role === 'employee' && actor.isManager) {
    const ids = await User.find({
      managerId: actor._id,
      status: 'active',
      deletedAt: null,
    }).distinct('_id');

    f.employeeId = {
      $in: q.employeeId
        ? ids.some((id) => String(id) === q.employeeId)
          ? [q.employeeId]
          : []
        : ids,
    };
  } else if (q.employeeId) {
    f.employeeId = q.employeeId;
  }

  if (q.courseId) f.courseId = q.courseId;
  if (q.status) and.push({ status: q.status });

  if (q.overdue !== undefined) {
    and.push(q.overdue ? { status: 'overdue' } : { status: { $ne: 'overdue' } });
  }

  if (and.length) f.$and = and;
  if (q.dueBefore) f.dueDate = { $lte: q.dueBefore };

  if (q.domainId) {
    const courses = await Course.find({ domainId: q.domainId }).distinct('_id');
    and.push({ courseId: { $in: courses } });
    f.$and = and;
  }

  return f;
};

const pageMeta = (query, total) => ({
  page: query.page,
  limit: query.limit,
  total,
  pages: Math.ceil(total / query.limit),
});

// Recompute progress from required modules and mark the assignment started
const refreshProgress = async (a) => {
  const required = a.courseId.modules.filter((m) => m.isRequired);
  const completed = await ModuleProgress.countDocuments({
    assignmentId: a._id,
    completed: true,
    moduleId: { $in: required.map((m) => m._id) },
  });

  a.progressPercent = required.length
    ? Math.floor((completed / required.length) * 100)
    : 100;

  if (a.status === 'not_started') {
    a.status = 'in_progress';
    a.startedAt = new Date();
  }

  await a.save();
};

// One progress update per 5 seconds per employee, assignment and module
const progressLimit = rateLimit({
  windowMs: 5000,
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${req.user._id}:${req.params.id}:${req.params.moduleId}`,
});

// ---------------------------------------------------------------------------
// Assignment rules
// ---------------------------------------------------------------------------

r.get(
  '/rules',
  authenticate,
  allow('admin', 'trainer'),
  validate({ query: listQuery.pick({ page: true, limit: true }) }),
  asyncHandler(async (req, res) => {
    const filter = {};

    // Trainers only see rules for courses in their own domains
    if (req.user.role === 'trainer') {
      const courses = await Course.find({
        domainId: { $in: req.user.trainerDomains || [] },
      }).distinct('_id');
      filter.courseId = { $in: courses };
    }

    const [data, total] = await Promise.all([
      AssignmentRule.find(filter)
        .populate({
          path: 'courseId',
          select: 'title domainId',
          populate: { path: 'domainId', select: 'name' },
        })
        .sort({ createdAt: -1 })
        .skip((req.query.page - 1) * req.query.limit)
        .limit(req.query.limit),
      AssignmentRule.countDocuments(filter),
    ]);

    ok(res, data, 'Rules', pageMeta(req.query, total));
  })
);

r.post(
  '/rules',
  authenticate,
  allow('admin'),
  body(ruleInput),
  asyncHandler(async (req, res) =>
    ok(res, await service.createRule(req.body, req.user), 'Rule created')
  )
);

r.post(
  '/rules/run',
  authenticate,
  allow('admin'),
  asyncHandler(async (_req, res) =>
    ok(res, await service.runRules(), 'Rules evaluated')
  )
);

r.post(
  '/rules/:id/preview',
  authenticate,
  allow('admin'),
  params(idParams),
  asyncHandler(async (req, res) => {
    const rule = await AssignmentRule.findById(req.params.id);
    if (!rule) throw new AppError(404, 'Rule not found', 'NOT_FOUND');

    const employees = await service.previewRule(rule);
    ok(res, employees, 'Matching employees', { total: employees.length });
  })
);

r.patch(
  '/rules/:id',
  authenticate,
  allow('admin'),
  params(idParams),
  body(rulePatch),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.updateRule(req.params.id, req.body, req.user),
      'Rule updated'
    )
  )
);

r.delete(
  '/rules/:id',
  authenticate,
  allow('admin'),
  params(idParams),
  asyncHandler(async (req, res) => {
    await service.deleteRule(req.params.id, req.user);
    ok(res, null, 'Rule deleted');
  })
);

// ---------------------------------------------------------------------------
// Assignments: lists
// ---------------------------------------------------------------------------

// Must stay above '/assignments/:id' so "me" is not treated as an id
r.get(
  '/assignments/me',
  authenticate,
  allow('employee'),
  validate({
    query: listQuery.pick({
      page: true,
      limit: true,
      status: true,
      dueBefore: true,
    }),
  }),
  asyncHandler(async (req, res) => {
    const f = { employeeId: req.user._id };
    if (req.query.status) f.status = req.query.status;
    if (req.query.dueBefore) f.dueDate = { $lte: req.query.dueBefore };

    const [data, total] = await Promise.all([
      Assignment.find(f)
        .populate('courseId')
        .sort({ dueDate: 1 })
        .skip((req.query.page - 1) * req.query.limit)
        .limit(req.query.limit),
      Assignment.countDocuments(f),
    ]);

    ok(res, data, 'Assignments', pageMeta(req.query, total));
  })
);

r.get(
  '/assignments',
  authenticate,
  allow('admin', 'manager'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const f = await scopeAssignmentQuery(req.query, req.user);

    const [data, total] = await Promise.all([
      Assignment.find(f)
        .populate('employeeId', 'name email')
        .populate('courseId')
        .sort({ dueDate: 1 })
        .skip((req.query.page - 1) * req.query.limit)
        .limit(req.query.limit),
      Assignment.countDocuments(f),
    ]);

    ok(res, data, 'Assignments', pageMeta(req.query, total));
  })
);

// ---------------------------------------------------------------------------
// Assignments: create, read, update
// ---------------------------------------------------------------------------

r.post(
  '/assignments',
  authenticate,
  allow('admin', 'manager'),
  body(createAssignmentInput),
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({
      _id: req.body.courseId,
      status: 'published',
    });
    if (!course) {
      throw new AppError(404, 'Published course not found', 'NOT_FOUND');
    }

    // Work out which employees the request targets
    const f = { role: 'employee', status: 'active', deletedAt: null };
    const ids =
      req.body.employeeIds || [req.body.employeeId].filter(Boolean);

    if (ids.length) f._id = { $in: ids };
    else Object.assign(f, req.body.filter);

    // Managers can only assign to their own direct reports
    if (req.user.role === 'employee' && req.user.isManager) {
      f.managerId = req.user._id;
    }

    const employees = await User.find(f).limit(1001);

    if (employees.length > 1000) {
      throw new AppError(
        422,
        'Assignment request exceeds 1000 employees',
        'LIMIT_EXCEEDED'
      );
    }
    if (ids.length && employees.length !== new Set(ids).size) {
      throw new AppError(404, 'One or more employees not found', 'NOT_FOUND');
    }

    const results = [];
    for (const employee of employees) {
      results.push(
        await service.createManualAssignment(
          {
            employeeId: employee._id,
            courseId: course._id,
            dueDate: req.body.dueDate,
          },
          req.user
        )
      );
    }

    // Single-employee request: return that one assignment
    if (req.body.employeeId) {
      return ok(
        res,
        results[0].assignment,
        results[0].created ? 'Assignment created' : 'Assignment already exists'
      );
    }

    // Bulk request: split into created and skipped
    ok(
      res,
      {
        created: results.filter((x) => x.created).map((x) => x.assignment),
        skipped: results.filter((x) => !x.created).map((x) => x.assignment),
        createdCount: results.filter((x) => x.created).length,
        skippedCount: results.filter((x) => !x.created).length,
      },
      'Assignments processed'
    );
  })
);

r.get(
  '/assignments/:id',
  authenticate,
  allow('admin', 'manager', 'employee'),
  params(idParams),
  asyncHandler(async (req, res) => {
    const assignment = await assignmentFor(req.params.id, req.user);
    const progress = await ModuleProgress.find({ assignmentId: assignment._id });

    ok(res, { ...assignment.toObject(), moduleProgress: progress });
  })
);

r.patch(
  '/assignments/:id',
  authenticate,
  allow('admin', 'manager'),
  params(idParams),
  body(patchAssignment),
  asyncHandler(async (req, res) => {
    const assignment = await assignmentFor(req.params.id, req.user);

    if (req.body.dueDate !== undefined) {
      assignment.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    } else if (req.body.cancel) {
      if (!['not_started', 'in_progress', 'overdue'].includes(assignment.status)) {
        throw new AppError(
          409,
          'Assignment cannot be cancelled in its current state',
          'INVALID_TRANSITION'
        );
      }
      assignment.status = 'cancelled';
    }

    await assignment.save();

    await AuditLog.create({
      actorId: req.user._id,
      action: 'assignment.update',
      entityType: 'Assignment',
      entityId: assignment._id,
      after: { dueDate: assignment.dueDate, status: assignment.status },
    });

    ok(res, assignment, 'Assignment updated');
  })
);

// ---------------------------------------------------------------------------
// Module progress
// ---------------------------------------------------------------------------

r.put(
  '/assignments/:id/modules/:moduleId/progress',
  authenticate,
  allow('employee'),
  progressLimit,
  validate({ params: moduleParams }),
  body(progressInput),
  asyncHandler(async (req, res) => {
    const a = await assignmentFor(req.params.id, req.user);

    if (a.status === 'cancelled' || a.status === 'completed') {
      throw new AppError(
        409,
        'Assignment does not accept progress',
        'INVALID_TRANSITION'
      );
    }

    const module = a.courseId.modules.id(req.params.moduleId);
    if (!module || module.type !== 'youtube') {
      throw new AppError(404, 'Video module not found', 'NOT_FOUND');
    }

    // Clamp reported values to the module's real duration
    const duration = Math.min(
      req.body.durationSeconds,
      module.durationSeconds || req.body.durationSeconds
    );
    const watched = Math.min(req.body.watchedSeconds, duration);
    const position = Math.min(req.body.lastPositionSeconds, duration);

    let p = await ModuleProgress.findOne({
      assignmentId: a._id,
      moduleId: module._id,
    });
    const now = Date.now();

    if (p) {
      // Reject progress that jumps ahead of real elapsed time, or goes backwards
      const elapsed = Math.max(
        0,
        (now - new Date(p.lastUpdatedAt || p.updatedAt || now).getTime()) / 1000
      );

      if (watched - p.watchedSeconds > elapsed + 15) {
        throw new AppError(
          422,
          'Progress jump exceeds elapsed time',
          'IMPLAUSIBLE_PROGRESS'
        );
      }
      if (watched < p.watchedSeconds) {
        throw new AppError(
          422,
          'watchedSeconds cannot decrease',
          'INVALID_PROGRESS'
        );
      }

      p.watchedSeconds = watched;
      p.lastPositionSeconds = position;
      p.durationSeconds = duration;
      p.lastUpdatedAt = new Date(now);
    } else {
      p = new ModuleProgress({
        assignmentId: a._id,
        employeeId: req.user._id,
        courseId: a.courseId._id,
        moduleId: module._id,
        watchedSeconds: watched,
        lastPositionSeconds: position,
        durationSeconds: duration,
        lastUpdatedAt: new Date(now),
      });
    }

    p.completed =
      p.completed || (watched / duration) * 100 >= module.completionThreshold;
    if (p.completed && !p.completedAt) p.completedAt = new Date();

    await p.save();
    await refreshProgress(a);

    ok(res, { progress: p, progressPercent: a.progressPercent }, 'Progress saved');
  })
);

r.post(
  '/assignments/:id/modules/:moduleId/complete',
  authenticate,
  allow('employee'),
  params(moduleParams),
  asyncHandler(async (req, res) => {
    const a = await assignmentFor(req.params.id, req.user);

    if (a.status === 'cancelled' || a.status === 'completed') {
      throw new AppError(
        409,
        'Assignment does not accept progress',
        'INVALID_TRANSITION'
      );
    }

    const module = a.courseId.modules.id(req.params.moduleId);
    if (!module || !['youtube', 'pdf', 'note', 'link'].includes(module.type)) {
      throw new AppError(404, 'Course module not found', 'NOT_FOUND');
    }

    await ModuleProgress.findOneAndUpdate(
      { assignmentId: a._id, moduleId: module._id },
      {
        $set: {
          employeeId: req.user._id,
          courseId: a.courseId._id,
          completed: true,
          completedAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await refreshProgress(a);

    ok(res, { progressPercent: a.progressPercent }, 'Module completed');
  })
);

export default r;