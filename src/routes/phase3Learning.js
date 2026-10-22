import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  Assignment,
  Assessment,
  Attempt,
  AuditLog,
  Certificate,
  Course,
  Settings,
  Upload,
  User,
} from '../models/index.js';
import { authenticate, allow } from '../middlewares/auth.js';
import { courseUpload } from '../middlewares/courseUpload.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { localUploadStorage, saveUpload } from '../services/uploadStorage.js';
import * as learning from '../services/phase3LearningService.js';
import * as resources from '../services/resourceService.js';
import { createCertificatePdf } from '../services/certificatePdf.js';

const r = Router();

const ok = (res, data, message = 'OK', meta = {}) =>
  res.json({ success: true, data, message, meta });

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const oid = z.string().regex(/^[a-f\d]{24}$/i);
const idParams = z.object({ id: oid }).strict();
const body = (schema) => validate({ body: schema });
const params = (schema) => validate({ params: schema });

const submitSchema = z
  .object({
    answers: z.record(z.union([oid, z.array(oid).max(10)])),
  })
  .strict();

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const publicVerifyLimit = rateLimit({
  windowMs: 3600000, // 1 hour
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      data: null,
      message: 'Too many verification requests',
      meta: {},
    }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Load an assignment, hiding it (404) from employees who don't own it
const attemptScope = async (id, user) => {
  const a = await Assignment.findById(id).populate('courseId');

  if (
    !a ||
    (user.role === 'employee' && String(a.employeeId) !== String(user._id))
  ) {
    throw new AppError(404, 'Assignment not found', 'NOT_FOUND');
  }

  return a;
};

// Can this user see this certificate?
const certScope = async (cert, user) => {
  if (user.role === 'admin') return true;

  if (user.role === 'trainer') {
    return Boolean(
      await Course.exists({
        _id: cert.courseId,
        domainId: { $in: user.trainerDomains || [] },
      })
    );
  }

  if (user.role === 'employee' && !user.isManager) {
    return String(cert.employeeId) === String(user._id);
  }

  if (user.role === 'employee' && user.isManager) {
    return Boolean(
      await User.exists({
        _id: cert.employeeId,
        managerId: user._id,
        status: 'active',
        deletedAt: null,
      })
    );
  }

  return false;
};

// Days before expiry that count as "expiring soon" (admin-configurable)
const expiringSoonDays = async () =>
  Number(
    (await Settings.findOne({ key: 'certificateExpiringSoonDays' }))?.value ?? 60
  );

// Build the Mongo filter for certificate lists, scoped to what the user may see
const certListFilter = async (user, query = {}) => {
  const f = {};
  const and = [];

  // Scope by role
  if (user.role === 'employee' && user.isManager) {
    const ids = await User.find({
      managerId: user._id,
      status: 'active',
      deletedAt: null,
    }).distinct('_id');

    f.employeeId = {
      $in: query.employeeId
        ? ids.some((id) => String(id) === query.employeeId)
          ? [query.employeeId]
          : []
        : ids,
    };
  } else if (user.role === 'trainer') {
    f.courseId = {
      $in: await Course.find({ trainerId: user._id }).distinct('_id'),
    };
  } else if (query.employeeId) {
    f.employeeId = query.employeeId;
  }

  // Status filters. Expiring/expired/valid are computed from expiryDate.
  if (query.status === 'expiring_soon') {
    const days = await expiringSoonDays();

    and.push(
      { status: { $nin: ['revoked', 'pending_verification'] } },
      {
        expiryDate: {
          $gte: new Date(),
          $lte: new Date(Date.now() + days * 86400000),
        },
      }
    );
  } else if (query.status === 'expired') {
    and.push(
      { status: { $nin: ['revoked', 'pending_verification'] } },
      { expiryDate: { $lt: new Date() } }
    );
  } else if (query.status === 'valid') {
    const days = await expiringSoonDays();

    and.push(
      { status: { $nin: ['revoked', 'pending_verification'] } },
      {
        $or: [
          { expiryDate: null },
          { expiryDate: { $gt: new Date(Date.now() + days * 86400000) } },
        ],
      }
    );
  } else if (query.status) {
    f.status = query.status;
  }

  if (and.length) f.$and = and;

  return f;
};

// Attach the live computed status to each certificate
const withLiveStatus = (rows) =>
  Promise.all(
    rows.map(async (cert) => ({
      ...cert.toObject(),
      status: await learning.getCertificateStatus(cert),
    }))
  );

// ---------------------------------------------------------------------------
// Assessment attempts
// ---------------------------------------------------------------------------

r.post(
  '/assignments/:id/attempts',
  authenticate,
  allow('employee'),
  params(idParams),
  asyncHandler(async (req, res) => {
    const a = await attemptScope(req.params.id, req.user);
    const out = await learning.startAttempt(a, req.user);

    ok(res, out, 'Assessment attempt started');
  })
);

r.get(
  '/assignments/:id/attempts',
  authenticate,
  allow('admin', 'trainer', 'employee'),
  params(idParams),
  asyncHandler(async (req, res) => {
    const a = await attemptScope(req.params.id, req.user);

    // Trainers only see attempts for courses in their own domains
    if (req.user.role === 'trainer') {
      const course = await Course.findOne({
        _id: a.courseId,
        domainId: { $in: req.user.trainerDomains || [] },
      });
      if (!course) throw new AppError(404, 'Assignment not found', 'NOT_FOUND');
    }

    const attempts = await Attempt.find({ assignmentId: a._id }).sort({
      attemptNumber: 1,
    });
    const assessment = await Assessment.findOne({ courseId: a.courseId });

    const explanations =
      assessment?.questions
        .filter((q) => q.explanation)
        .map((q) => ({
          questionId: String(q._id),
          explanation: q.explanation,
        })) || [];

    // Explanations are only revealed for submitted attempts
    ok(
      res,
      attempts.map((item) => ({
        ...item.toObject(),
        explanations: item.status === 'submitted' ? explanations : [],
      })),
      'Assessment attempts'
    );
  })
);

r.post(
  '/attempts/:id/submit',
  authenticate,
  allow('employee'),
  params(idParams),
  body(submitSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await learning.submitAttempt(req.params.id, req.user, req.body.answers),
      'Assessment submitted'
    )
  )
);

r.post(
  '/admin/repair/certificates',
  authenticate,
  allow('admin'),
  asyncHandler(async (req, res) => {
    const result = await learning.repairCertificates(req.user);

    await AuditLog.create({
      actorId: req.user._id,
      action: 'certificate.repair',
      entityType: 'Certificate',
      after: result,
    });

    ok(res, result, 'Certificate records repaired');
  })
);

// ---------------------------------------------------------------------------
// Certificates: lists
// ---------------------------------------------------------------------------

r.get(
  '/certificates/me',
  authenticate,
  allow('employee'),
  asyncHandler(async (req, res) => {
    const rows = await Certificate.find({ employeeId: req.user._id })
      .populate('courseId', 'title courseCode')
      .populate('uploadId', 'originalName')
      .sort({ issueDate: -1 });

    ok(res, await withLiveStatus(rows), 'Certificates');
  })
);

r.get(
  '/certificates/expiring',
  authenticate,
  allow('admin', 'manager', 'trainer'),
  validate({
    query: z
      .object({
        days: z.coerce.number().int().min(1).max(365).default(60),
        employeeId: oid.optional(),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const f = await certListFilter(req.user, req.query);

    f.status = { $nin: ['revoked', 'pending_verification'] };
    f.expiryDate = {
      $gte: new Date(),
      $lte: new Date(Date.now() + req.query.days * 86400000),
    };

    const rows = await Certificate.find(f).sort({ expiryDate: 1 });

    ok(
      res,
      rows.map((c) => ({ ...c.toObject(), status: 'expiring_soon' })),
      'Expiring certificates'
    );
  })
);

r.get(
  '/certificates',
  authenticate,
  allow('admin', 'manager', 'trainer'),
  validate({
    query: z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        employeeId: oid.optional(),
        status: z
          .enum([
            'valid',
            'expiring_soon',
            'expired',
            'revoked',
            'pending_verification',
          ])
          .optional(),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const f = await certListFilter(req.user, req.query);

    const [rows, total] = await Promise.all([
      Certificate.find(f)
        .populate('employeeId', 'name email designation')
        .populate('courseId', 'title courseCode')
        .populate('uploadId', 'originalName')
        .sort({ issueDate: -1 })
        .skip((req.query.page - 1) * req.query.limit)
        .limit(req.query.limit),
      Certificate.countDocuments(f),
    ]);

    ok(res, await withLiveStatus(rows), 'Certificates', {
      page: req.query.page,
      limit: req.query.limit,
      total,
      pages: Math.ceil(total / req.query.limit),
    });
  })
);

// ---------------------------------------------------------------------------
// Certificates: upload, verify, revoke
// ---------------------------------------------------------------------------

r.post(
  '/certificates',
  authenticate,
  allow('admin', 'employee'),
  courseUpload.single('file'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        courseId: oid,
        employeeId: oid.optional(),
        expiryDate: z.string().datetime({ offset: true }).optional(),
      })
      .strict()
      .parse(req.body);

    // Employees upload for themselves; admins must name the employee
    const employeeId =
      req.user.role === 'employee' ? req.user._id : input.employeeId;
    if (!employeeId) {
      throw new AppError(
        422,
        'employeeId is required for admin uploads',
        'VALIDATION_ERROR'
      );
    }

    const employee = await User.findOne({
      _id: employeeId,
      role: 'employee',
      status: 'active',
      deletedAt: null,
    });
    if (!employee) throw new AppError(404, 'Employee not found', 'NOT_FOUND');

    const course = await Course.findOne({
      _id: input.courseId,
      status: 'published',
    }).select('title');
    if (!course) {
      throw new AppError(404, 'Published course not found', 'NOT_FOUND');
    }

    const upload = await saveUpload(req.file, req.user, null);

    const cert = await Certificate.create({
      employeeId,
      courseId: input.courseId,
      title: course.title,
      issueDate: new Date(),
      expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
      status: 'pending_verification',
      uploadId: upload._id,
      source: 'external',
    });

    await AuditLog.create({
      actorId: req.user._id,
      action: 'certificate.external_upload',
      entityType: 'Certificate',
      entityId: cert._id,
      after: { employeeId, courseId: input.courseId },
    });

    ok(res, cert, 'Certificate submitted for verification');
  })
);

r.patch(
  '/certificates/:id/verify',
  authenticate,
  allow('admin', 'trainer'),
  params(idParams),
  asyncHandler(async (req, res) => {
    const cert = await Certificate.findById(req.params.id);
    if (!cert) throw new AppError(404, 'Certificate not found', 'NOT_FOUND');

    if (String(cert.employeeId) === String(req.user._id)) {
      throw new AppError(
        403,
        'You cannot verify your own certificate',
        'FORBIDDEN'
      );
    }

    if (
      req.user.role === 'trainer' &&
      !(await Course.exists({
        _id: cert.courseId,
        domainId: { $in: req.user.trainerDomains || [] },
      }))
    ) {
      throw new AppError(404, 'Certificate not found', 'NOT_FOUND');
    }

    // Verifying twice as the same person is a harmless no-op
    if (cert.status === 'valid' && String(cert.verifiedBy) === String(req.user._id)) {
      return ok(res, cert, 'Certificate already verified');
    }

    if (cert.status !== 'pending_verification') {
      throw new AppError(
        409,
        'Only pending certificates can be verified',
        'INVALID_STATE'
      );
    }

    const before = cert.status;
    cert.status = 'valid';
    cert.verifiedBy = req.user._id;
    await cert.save();

    await AuditLog.create({
      actorId: req.user._id,
      action: 'certificate.verify',
      entityType: 'Certificate',
      entityId: cert._id,
      before: { status: before },
      after: { status: cert.status },
    });

    ok(res, cert, 'Certificate verified');
  })
);

r.patch(
  '/certificates/:id/revoke',
  authenticate,
  allow('admin'),
  params(idParams),
  body(z.object({ reason: z.string().min(1).max(1000) }).strict()),
  asyncHandler(async (req, res) => {
    const cert = await Certificate.findById(req.params.id);
    if (!cert) throw new AppError(404, 'Certificate not found', 'NOT_FOUND');

    const before = cert.status;
    cert.status = 'revoked';
    cert.revokeReason = req.body.reason;
    await cert.save();

    await AuditLog.create({
      actorId: req.user._id,
      action: 'certificate.revoke',
      entityType: 'Certificate',
      entityId: cert._id,
      before: { status: before },
      after: { status: 'revoked', reason: req.body.reason },
    });

    ok(res, cert, 'Certificate revoked');
  })
);

// ---------------------------------------------------------------------------
// Certificates: public verification and file download
// ---------------------------------------------------------------------------

// Public endpoint (no login), rate limited
r.get(
  '/certificates/verify/:certificateNumber',
  publicVerifyLimit,
  params(
    z
      .object({
        certificateNumber: z.string().regex(/^NEX-[A-Z0-9]{1,8}-\d{4}-\d{6}$/),
      })
      .strict()
  ),
  asyncHandler(async (req, res) => {
    const cert = await Certificate.findOne({
      certificateNumber: req.params.certificateNumber,
      status: { $ne: 'revoked' },
    });
    if (!cert) throw new AppError(404, 'Certificate not found', 'NOT_FOUND');

    const valid = ['valid', 'expiring_soon'].includes(
      await learning.getCertificateStatus(cert)
    );

    const [user, course] = await Promise.all([
      User.findById(cert.employeeId).select('name'),
      Course.findById(cert.courseId).select('title'),
    ]);

    ok(
      res,
      {
        valid,
        holderName: user?.name || '',
        title: course?.title || cert.title,
        issueDate: cert.issueDate,
        expiryDate: cert.expiryDate,
      },
      'Certificate verification'
    );
  })
);

r.get(
  '/certificates/:id/file',
  authenticate,
  allow('admin', 'manager', 'trainer', 'employee'),
  params(idParams),
  asyncHandler(async (req, res) => {
    const cert = await Certificate.findById(req.params.id);

    if (!cert || !(await certScope(cert, req.user))) {
      throw new AppError(404, 'Certificate not found', 'NOT_FOUND');
    }

    // External certificates: serve the uploaded file
    if (cert.uploadId) {
      const upload = await Upload.findById(cert.uploadId);
      if (!upload) {
        throw new AppError(404, 'Certificate file not found', 'NOT_FOUND');
      }

      const bytes = await localUploadStorage.get(upload.storageName);

      return res
        .type(upload.mimeType)
        .attachment(upload.originalName.replace(/["\\]/g, '_'))
        .send(bytes);
    }

    if (cert.source !== 'internal') {
      throw new AppError(404, 'Certificate file not found', 'NOT_FOUND');
    }

    // Internal certificates: generate the PDF on the fly
    const [employee, course] = await Promise.all([
      User.findById(cert.employeeId).select('name').lean(),
      Course.findById(cert.courseId).select('title').lean(),
    ]);

    const bytes = createCertificatePdf({
      employeeName: employee?.name || 'Nexora learner',
      courseTitle: course?.title || cert.title || 'Completed course',
      certificateNumber: cert.certificateNumber,
      issueDate: cert.issueDate,
      expiryDate: cert.expiryDate,
    });

    const filename = `${String(
      cert.certificateNumber || 'nexora-certificate'
    ).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;

    res.type('application/pdf').attachment(filename).send(bytes);
  })
);

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

r.get(
  '/users/:id/compliance',
  authenticate,
  allow('admin', 'manager', 'employee'),
  params(idParams),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await learning.complianceFor(
        await resources.getUser(req.params.id, req.user)
      ),
      'Compliance summary'
    )
  )
);

export default r;