import { Router } from 'express';
import { z } from 'zod';
import {
  Assignment,
  Assessment,
  AuditLog,
  Attempt,
  Certificate,
  Course,
  Domain,
  Notification,
  Settings,
  User,
} from '../models/index.js';
import { authenticate, allow } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { jobRunners } from '../services/jobService.js';
import { complianceFor } from '../services/phase3LearningService.js';

const r = Router();

const ok = (res, data, message = 'OK', meta = {}) =>
  res.json({ success: true, data, message, meta });

const oid = z.string().regex(/^[a-f\d]{24}$/i);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

r.get(
  '/notifications',
  authenticate,
  allow('admin', 'trainer', 'employee'),
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        unreadOnly: z.enum(['true', 'false']).optional(),
      })
      .strict()
      .parse(req.query);

    const filter = { userId: req.user._id };
    if (q.unreadOnly === 'true') filter.readAt = null;

    const [data, total] = await Promise.all([
      Notification.find(filter)
        .sort({ readAt: 1, createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Notification.countDocuments(filter),
    ]);

    ok(res, data, 'Notifications', {
      page: q.page,
      limit: q.limit,
      total,
      pages: Math.ceil(total / q.limit),
    });
  })
);

r.patch(
  '/notifications/:id/read',
  authenticate,
  allow('admin', 'trainer', 'employee'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: oid }).strict().parse(req.params);

    const n = await Notification.findOneAndUpdate(
      { _id: id, userId: req.user._id, readAt: null },
      { $set: { readAt: new Date() } },
      { new: true }
    );

    if (!n) {
      const existing = await Notification.findOne({
        _id: id,
        userId: req.user._id,
      });
      if (!existing) {
        throw new AppError(404, 'Notification not found', 'NOT_FOUND');
      }
      return ok(res, existing, 'Notification already read');
    }

    ok(res, n, 'Notification marked read');
  })
);

r.patch(
  '/notifications/read-all',
  authenticate,
  allow('admin', 'trainer', 'employee'),
  asyncHandler(async (req, res) => {
    const result = await Notification.updateMany(
      { userId: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );

    ok(res, { modified: result.modifiedCount }, 'Notifications marked read');
  })
);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const settingsShape = z
  .object({
    reminderThresholds: z
      .array(z.number().int().min(0).max(3650))
      .min(1)
      .max(10)
      .optional(),
    certificateExpiringSoonDays: z.number().int().min(1).max(365).optional(),
    certificateRenewalDays: z.number().int().min(1).max(365).optional(),
    lockoutFailures: z.number().int().min(3).max(20).optional(),
    lockoutMinutes: z.number().int().min(1).max(1440).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one setting is required',
  });

r.get(
  '/settings',
  authenticate,
  allow('admin'),
  asyncHandler(async (_req, res) => {
    const rows = await Settings.find({});

    // Defaults, overridden by any stored values
    const data = {
      reminderThresholds: [90, 60, 30, 7, 0],
      certificateExpiringSoonDays: 60,
      certificateRenewalDays: 60,
      lockoutFailures: 5,
      lockoutMinutes: 15,
    };
    for (const row of rows) data[row.key] = row.value;

    ok(res, data, 'Settings');
  })
);

r.patch(
  '/settings',
  authenticate,
  allow('admin'),
  validate({ body: settingsShape }),
  asyncHandler(async (req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
      await Settings.updateOne({ key }, { $set: { value } }, { upsert: true });
    }

    await AuditLog.create({
      actorId: req.user._id,
      action: 'settings.update',
      entityType: 'Settings',
      after: req.body,
    });

    const rows = await Settings.find({});
    ok(
      res,
      Object.fromEntries(rows.map((x) => [x.key, x.value])),
      'Settings updated'
    );
  })
);

// ---------------------------------------------------------------------------
// Manual job runs
// ---------------------------------------------------------------------------

r.post(
  '/admin/jobs/:jobName/run',
  authenticate,
  allow('admin'),
  asyncHandler(async (req, res) => {
    const { jobName } = z
      .object({ jobName: z.enum(['nightly', 'reminders', 'youtube']) })
      .strict()
      .parse(req.params);

    const result = await jobRunners[jobName]();

    await AuditLog.create({
      actorId: req.user._id,
      action: 'job.manual_run',
      entityType: 'Job',
      after: { jobName, result },
    });

    ok(res, result, `${jobName} job completed`);
  })
);

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

// Escape one CSV cell. Cells starting with = + - @ get a leading quote
// so spreadsheet apps don't run them as formulas.
const esc = (value) => {
  let s;

  if (value === null || value === undefined) s = '';
  else if (value instanceof Date) s = value.toISOString();
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);

  if (/^\s*[=+\-@]/.test(s)) s = "'" + s;

  return `"${s.replaceAll('"', '""')}"`;
};

const csv = (res, rows) => {
  const columns = [...new Set(rows.flatMap((x) => Object.keys(x)))];

  res
    .type('text/csv')
    .attachment('report.csv')
    .send(
      [
        columns.map(esc).join(','),
        ...rows.map((row) => columns.map((k) => esc(row[k])).join(',')),
      ].join('\r\n')
    );
};

// Employees the caller may see: everyone for admin/trainer, direct reports otherwise
const employeeScope = async (user) =>
  ['admin', 'trainer'].includes(user.role)
    ? {}
    : {
        _id: {
          $in: await User.find({
            managerId: user._id,
            status: 'active',
            deletedAt: null,
          }).distinct('_id'),
        },
      };

// Query filter for assignment and certificate reports, by caller role
const reportFilter = async (user) => {
  if (user.role === 'admin') return {};

  if (user.role === 'employee' && user.isManager) {
    return {
      employeeId: {
        $in: await User.find({
          managerId: user._id,
          status: 'active',
          deletedAt: null,
        }).distinct('_id'),
      },
    };
  }

  return {
    courseId: { $in: await Course.find({ trainerId: user._id }).distinct('_id') },
  };
};

const normalizedAnswer = (value) =>
  (Array.isArray(value) ? value : [value])
    .filter((x) => x !== undefined && x !== null)
    .map(String)
    .sort();

async function reportRows(name, user, courseId, months) {
  const s = await reportFilter(user);

  // ---- Compliance: counts per domain / location / course ----
  if (name === 'compliance') {
    const people = await User.find({
      ...(await employeeScope(user)),
      role: 'employee',
      status: 'active',
      deletedAt: null,
    }).select('_id name email domainId location managerId');

    const trainerCourseSet =
      user.role === 'trainer'
        ? new Set((s.courseId?.$in || []).map(String))
        : null;

    const groups = new Map();
    const courseCache = new Map();
    const domainCache = new Map();

    // Process employees in batches of 5
    for (let offset = 0; offset < people.length; offset += 5) {
      const batch = people.slice(offset, offset + 5);
      const results = await Promise.all(
        batch.map((person) => complianceFor(person))
      );

      for (let index = 0; index < batch.length; index++) {
        const person = batch[index];
        const result = results[index];

        for (const item of result.mandatoryCourses) {
          if (trainerCourseSet && !trainerCourseSet.has(String(item.courseId))) {
            continue;
          }

          let course = courseCache.get(String(item.courseId));
          if (!course) {
            course = await Course.findById(item.courseId)
              .select('title domainId')
              .lean();
            courseCache.set(String(item.courseId), course);
          }
          if (!course) continue;

          const key = `${course.domainId}:${person.location || ''}:${course._id}`;
          let row = groups.get(key);

          if (!row) {
            let domainName = domainCache.get(String(course.domainId));
            if (domainName === undefined) {
              domainName =
                (await Domain.findById(course.domainId).select('name').lean())
                  ?.name || '';
              domainCache.set(String(course.domainId), domainName);
            }

            row = {
              domainId: String(course.domainId),
              domainName,
              location: person.location || '',
              courseId: String(course._id),
              courseTitle: course.title,
              total: 0,
              compliant: 0,
              inProgress: 0,
              overdue: 0,
              expiring: 0,
              missing: 0,
            };
            groups.set(key, row);
          }

          row.total++;
          const status =
            item.status === 'in progress' ? 'inProgress' : item.status;
          if (Object.hasOwn(row, status)) row[status]++;
        }
      }
    }

    return [...groups.values()];
  }

  // ---- Completed assignments ----
  if (name === 'completion') {
    return Assignment.find({ ...s, status: 'completed' })
      .populate('employeeId', 'name email domainId location')
      .populate('courseId', 'title domainId')
      .lean();
  }

  // ---- Overdue assignments ----
  if (name === 'overdue') {
    return Assignment.find({ ...s, status: 'overdue' })
      .populate('employeeId', 'name email domainId location')
      .populate('courseId', 'title domainId')
      .lean();
  }

  // ---- Certificates expiring within the next N months ----
  if (name === 'expiry-forecast') {
    const until = new Date(Date.now() + months * 30.4375 * 86400000);

    return Certificate.find({
      ...s,
      expiryDate: { $gte: new Date(), $lte: until },
      status: { $nin: ['revoked', 'pending_verification'] },
    })
      .populate('employeeId', 'name email domainId location')
      .populate('courseId', 'title domainId')
      .lean();
  }

  // ---- Per-course assignments for a trainer ----
  if (name === 'trainer') {
    const c = await Course.findOne({
      _id: courseId,
      ...(user.role === 'trainer' ? { trainerId: user._id } : {}),
    });
    if (!c) throw new AppError(404, 'Course not found', 'NOT_FOUND');

    const f = { courseId: c._id };
    if (user.role === 'manager') f.employeeId = s.employeeId;

    return Assignment.find(f)
      .populate('employeeId', 'name email domainId location')
      .lean();
  }

  // ---- Per-question pass rates for a course assessment ----
  if (name === 'assessment-quality') {
    const c = await Course.findOne({
      _id: courseId,
      ...(user.role === 'trainer' ? { trainerId: user._id } : {}),
    });
    if (!c) throw new AppError(404, 'Course not found', 'NOT_FOUND');

    const assessment = await Assessment.findOne({ courseId: c._id }).lean();
    if (!assessment) return [];

    const f = { courseId: c._id, status: 'submitted' };
    if (user.role === 'manager') f.employeeId = s.employeeId;

    const attempts = await Attempt.find(f).lean();

    return assessment.questions.map((q) => {
      const correct = q.options
        .filter((o) => o.isCorrect)
        .map((o) => String(o._id))
        .sort();

      const passed = attempts.filter((a) => {
        const answer = normalizedAnswer(a.answers?.[String(q._id)]);
        return (
          answer.length === correct.length &&
          answer.every((id, index) => id === correct[index])
        );
      }).length;

      return {
        courseId: String(c._id),
        courseTitle: c.title,
        questionId: String(q._id),
        question: q.text,
        attempts: attempts.length,
        passed,
        passRate: attempts.length
          ? Math.round((passed / attempts.length) * 100)
          : 0,
      };
    });
  }

  throw new AppError(404, 'Report not found', 'NOT_FOUND');
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const collectionReport = (name) =>
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        format: z.enum(['json', 'csv']).default('json'),
        months: z.coerce.number().int().min(1).max(36).default(3),
      })
      .strict()
      .parse(req.query);

    const rows = await reportRows(name, req.user, null, query.months);

    if (query.format === 'csv') {
      return csv(
        res,
        rows.map((x) => (x.toObject ? x.toObject() : x))
      );
    }

    ok(res, rows, `${name} report`);
  });

const courseReport = (name) =>
  asyncHandler(async (req, res) => {
    const { courseId } = z
      .object({ courseId: oid })
      .strict()
      .parse(req.params);
    const format = z
      .enum(['json', 'csv'])
      .default('json')
      .parse(req.query.format || 'json');

    const rows = await reportRows(name, req.user, courseId, 3);

    if (format === 'csv') {
      return csv(
        res,
        rows.map((x) => (x.toObject ? x.toObject() : x))
      );
    }

    ok(res, rows, `${name} report`);
  });

const reportRoles = ['admin', 'manager', 'trainer'];

r.get(
  '/reports/compliance',
  authenticate,
  allow(...reportRoles),
  collectionReport('compliance')
);
r.get(
  '/reports/completion',
  authenticate,
  allow(...reportRoles),
  collectionReport('completion')
);
r.get(
  '/reports/expiry-forecast',
  authenticate,
  allow(...reportRoles),
  collectionReport('expiry-forecast')
);
r.get(
  '/reports/overdue',
  authenticate,
  allow(...reportRoles),
  collectionReport('overdue')
);
r.get(
  '/reports/trainer/:courseId',
  authenticate,
  allow(...reportRoles),
  courseReport('trainer')
);
r.get(
  '/reports/assessment-quality/:courseId',
  authenticate,
  allow(...reportRoles),
  courseReport('assessment-quality')
);

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

r.get(
  '/audit-logs',
  authenticate,
  allow('admin'),
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        actorId: oid.optional(),
        entityType: z.string().max(60).optional(),
        entityId: oid.optional(),
        action: z.string().max(100).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict()
      .parse(req.query);

    const f = {};
    for (const k of ['actorId', 'entityType', 'entityId', 'action']) {
      if (q[k]) f[k] = q[k];
    }

    if (q.from || q.to) {
      f.createdAt = {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      AuditLog.find(f)
        .populate('actorId', 'name email')
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      AuditLog.countDocuments(f),
    ]);

    // Split the populated actor into `actor` (object) and `actorId` (string)
    const rows = data.map((log) => {
      const row = log.toObject();
      const actor = row.actorId;

      row.actor = actor && typeof actor === 'object' ? actor : null;
      row.actorId = actor?._id ? String(actor._id) : actor ? String(actor) : null;

      return row;
    });

    ok(res, rows, 'Audit logs', {
      page: q.page,
      limit: q.limit,
      total,
      pages: Math.ceil(total / q.limit),
    });
  })
);

export default r;