import mongoose from 'mongoose';
import { generateCourseCode } from '../utils/courseCode.js';

const { Schema, model } = mongoose;
const opts = { timestamps: true, strict: 'throw' };
const ObjectId = Schema.Types.ObjectId;

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

const userSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, maxlength: 32 },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['admin', 'trainer', 'employee'],
      default: 'employee',
    },
    domainId: { type: ObjectId, ref: 'Domain' },
    trainerDomains: [{ type: ObjectId, ref: 'Domain' }],
    designation: String,
    level: {
      type: String,
      enum: ['new_joiner', 'junior', 'mid', 'senior', 'team_lead', 'manager'],
    },
    location: String,
    tags: [String],
    managerId: { type: ObjectId, ref: 'User' },
    joinedOn: Date,
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    deletedAt: { type: Date, default: null },
    forcePasswordChange: { type: Boolean, default: false },

    // Auth internals (hidden from queries by default)
    tokenVersion: { type: Number, default: 0, select: false },
    refreshTokenHash: { type: String, select: false },
    loginFailures: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    resetTokenHash: { type: String, select: false },
    resetExpires: { type: Date, select: false },
    lastLoginAt: Date,
  },
  opts
);

userSchema.index({ domainId: 1, role: 1, status: 1 });

// Never expose auth internals in JSON output
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    for (const key of [
      'passwordHash',
      'refreshTokenHash',
      'tokenVersion',
      'resetTokenHash',
      'resetExpires',
      'loginFailures',
      'lockUntil',
    ]) {
      delete ret[key];
    }
    return ret;
  },
});

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

const domainSchema = new Schema(
  {
    name: { type: String, unique: true, required: true },
    description: String,
    headId: { type: ObjectId, ref: 'User' },
    isCommon: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  opts
);

// ---------------------------------------------------------------------------
// Course (with embedded modules)
// ---------------------------------------------------------------------------

const moduleSchema = new Schema({
  title: { type: String, required: true, maxlength: 200 },
  order: Number,
  type: {
    type: String,
    enum: ['youtube', 'pdf', 'note', 'link'],
    required: true,
  },
  youtubeVideoId: String,
  sourceUrl: String,
  uploadId: String,
  durationSeconds: Number,
  completionThreshold: { type: Number, default: 90 },
  isRequired: { type: Boolean, default: true },
  notes: String,
});

const courseSchema = new Schema(
  {
    title: { type: String, required: true },
    courseCode: {
      type: String,
      unique: true,
      sparse: true,
      default: generateCourseCode,
    },
    description: String,
    domainId: { type: ObjectId, ref: 'Domain', required: true, index: true },
    trainerId: { type: ObjectId, ref: 'User', required: true },
    version: { type: Number, default: 1 },
    versionOf: { type: ObjectId, ref: 'Course' },
    status: {
      type: String,
      enum: ['draft', 'under_review', 'published', 'archived', 'rejected'],
      default: 'draft',
      index: true,
    },
    reviewNotes: String,
    isMandatory: { type: Boolean, default: false },
    validityMonths: { type: Number, default: null },
    passMark: { type: Number, default: 70 },
    maxAttempts: { type: Number, default: 3 },
    estimatedMinutes: Number,
    tags: [String],
    eligibility: Schema.Types.Mixed,
    modules: [moduleSchema],
    publishedAt: Date,
    approvedBy: { type: ObjectId, ref: 'User' },
  },
  opts
);

courseSchema.index({ domainId: 1, status: 1, isMandatory: 1 });
courseSchema.index(
  { versionOf: 1, version: 1 },
  { unique: true, partialFilterExpression: { versionOf: { $exists: true } } }
);

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

const assignmentSchema = new Schema(
  {
    employeeId: { type: ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: ObjectId, ref: 'Course', required: true },
    courseVersion: Number,
    cycle: { type: String, default: 'none' },
    source: {
      type: String,
      enum: ['rule', 'manual', 'expiry_renewal', 'onboarding'],
      default: 'manual',
    },
    ruleId: ObjectId,
    assignedBy: ObjectId,
    dueDate: Date,
    status: {
      type: String,
      enum: [
        'not_started',
        'in_progress',
        'completed',
        'overdue',
        'expired',
        'cancelled',
      ],
      default: 'not_started',
      index: true,
    },
    progressPercent: { type: Number, default: 0 },
    followUpRequired: { type: Boolean, default: false },
    startedAt: Date,
    completedAt: Date,
  },
  opts
);

assignmentSchema.index({
  employeeId: 1,
  courseId: 1,
  courseVersion: 1,
  status: 1,
});
assignmentSchema.index(
  { employeeId: 1, courseId: 1, courseVersion: 1, cycle: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: ['not_started', 'in_progress', 'completed', 'overdue', 'expired'],
      },
    },
  }
);
assignmentSchema.index({ employeeId: 1, status: 1, dueDate: 1 });

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

const uploadSchema = new Schema(
  {
    storageName: { type: String, required: true, unique: true },
    originalName: { type: String, required: true },
    mimeType: {
      type: String,
      enum: ['application/pdf', 'image/jpeg', 'image/png'],
      required: true,
    },
    size: { type: Number, required: true },
    uploadedBy: { type: ObjectId, ref: 'User', required: true },
    courseId: { type: ObjectId, ref: 'Course' },
  },
  opts
);

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

const resetSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, unique: true },
    tokenHash: { type: String, select: false },
    expiresAt: Date,
    usedAt: Date,
  },
  opts
);

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

const questionSchema = new Schema({
  text: { type: String, maxlength: 2000 },
  type: {
    type: String,
    enum: ['single_choice', 'multiple_choice', 'true_false'],
    default: 'single_choice',
  },
  options: [
    {
      text: { type: String, maxlength: 500 },
      isCorrect: Boolean,
    },
  ],
  explanation: { type: String, maxlength: 2000 },
  marks: Number,
});

const assessmentSchema = new Schema(
  {
    courseId: { type: ObjectId, ref: 'Course', unique: true },
    questions: [questionSchema],
    timeLimitMinutes: Number,
    shuffleQuestions: Boolean,
    shuffleOptions: Boolean,
  },
  opts
);

// ---------------------------------------------------------------------------
// Module progress
// ---------------------------------------------------------------------------

const moduleProgressSchema = new Schema(
  {
    assignmentId: { type: ObjectId, required: true },
    employeeId: { type: ObjectId, required: true },
    courseId: ObjectId,
    moduleId: { type: ObjectId, required: true },
    watchedSeconds: { type: Number, default: 0 },
    lastPositionSeconds: Number,
    durationSeconds: Number,
    completed: Boolean,
    completedAt: Date,
    lastUpdatedAt: Date,
  },
  opts
);

moduleProgressSchema.index({ assignmentId: 1, moduleId: 1 }, { unique: true });

// ---------------------------------------------------------------------------
// Attempt
// ---------------------------------------------------------------------------

const attemptSchema = new Schema(
  {
    assignmentId: { type: ObjectId, required: true },
    employeeId: ObjectId,
    courseId: ObjectId,
    answers: Schema.Types.Mixed,
    scorePercent: Number,
    passed: Boolean,
    attemptNumber: Number,
    startedAt: Date,
    submittedAt: Date,
    status: {
      type: String,
      enum: ['open', 'submitted', 'timed_out'],
      default: 'open',
    },
    followUpRequired: { type: Boolean, default: false },
  },
  opts
);

attemptSchema.index({ assignmentId: 1, attemptNumber: 1 }, { unique: true });
attemptSchema.index(
  { assignmentId: 1, submittedAt: 1 },
  { unique: true, partialFilterExpression: { submittedAt: null } }
);

// ---------------------------------------------------------------------------
// Certificate and its number counter
// ---------------------------------------------------------------------------

const certificateSchema = new Schema(
  {
    assignmentId: { type: ObjectId },
    employeeId: { type: ObjectId, ref: 'User', index: true },
    courseId: { type: ObjectId, ref: 'Course' },
    title: String,
    issuedBy: ObjectId,
    certificateNumber: { type: String, unique: true, sparse: true },
    issueDate: Date,
    expiryDate: Date,
    status: {
      type: String,
      enum: [
        'valid',
        'expiring_soon',
        'expired',
        'revoked',
        'pending_verification',
      ],
      default: 'valid',
    },
    revokeReason: String,
    documentUrl: String,
    uploadId: { type: ObjectId, ref: 'Upload' },
    verifiedBy: ObjectId,
    source: { type: String, enum: ['internal', 'external'], default: 'internal' },
  },
  opts
);

certificateSchema.index(
  { assignmentId: 1 },
  { unique: true, partialFilterExpression: { assignmentId: { $exists: true } } }
);

const certificateCounterSchema = new Schema(
  {
    domainId: { type: ObjectId, required: true },
    year: { type: Number, required: true },
    sequence: { type: Number, default: 0 },
  },
  { timestamps: true }
);

certificateCounterSchema.index({ domainId: 1, year: 1 }, { unique: true });

// ---------------------------------------------------------------------------
// Assignment rule
// ---------------------------------------------------------------------------

const assignmentRuleSchema = new Schema(
  {
    name: { type: String, required: true },
    courseId: { type: ObjectId, required: true, ref: 'Course' },
    isActive: { type: Boolean, default: true },
    conditions: [
      {
        field: {
          type: String,
          enum: [
            'domainId',
            'role',
            'designation',
            'level',
            'location',
            'joinedWithinDays',
            'tag',
          ],
        },
        operator: {
          type: String,
          enum: ['eq', 'in', 'not_in', 'gte', 'lte'],
        },
        value: Schema.Types.Mixed,
      },
    ],
    matchType: { type: String, enum: ['all', 'any'], default: 'all' },
    recurrence: {
      type: {
        type: String,
        enum: ['none', 'annual', 'custom'],
        default: 'none',
      },
      months: Number,
    },
    dueInDays: { type: Number, min: 0, max: 3650 },
  },
  opts
);

// ---------------------------------------------------------------------------
// Reminders, audit, notifications, sessions, settings
// ---------------------------------------------------------------------------

const reminderLogSchema = new Schema(
  {
    dedupeKey: { type: String, unique: true, sparse: true },
    userId: ObjectId,
    certificateId: ObjectId,
    assignmentId: ObjectId,
    employeeId: ObjectId,
    type: String,
    daysBefore: Number,
    channel: String,
    sentAt: Date,
    status: String,
    error: String,
    attempts: { type: Number, default: 0 },
    escalatedTo: ObjectId,
  },
  opts
);

const auditLogSchema = new Schema(
  {
    actorId: { type: ObjectId, ref: 'User' },
    action: String,
    entityType: String,
    entityId: ObjectId,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' }
);

const notificationSchema = new Schema(
  {
    userId: ObjectId,
    title: String,
    message: String,
    type: String,
    readAt: Date,
    link: String,
    reminderKey: { type: String, unique: true, sparse: true },
  },
  opts
);

const refreshSessionSchema = new Schema(
  {
    userId: ObjectId,
    tokenHash: { type: String, select: false },
    tokenVersion: { type: Number, default: 0 },
    familyId: String,
    expiresAt: Date,
    usedAt: Date,
    userAgent: String,
    ip: String,
  },
  opts
);

const settingsSchema = new Schema(
  {
    key: { type: String, unique: true },
    value: Schema.Types.Mixed,
  },
  opts
);

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export const User = model('User', userSchema);
export const Domain = model('Domain', domainSchema);
export const Course = model('Course', courseSchema);
export const Assessment = model('Assessment', assessmentSchema);
export const Assignment = model('Assignment', assignmentSchema);
export const ModuleProgress = model('ModuleProgress', moduleProgressSchema);
export const Attempt = model('Attempt', attemptSchema);
export const Certificate = model('Certificate', certificateSchema);
export const AssignmentRule = model('AssignmentRule', assignmentRuleSchema);
export const CertificateCounter = model(
  'CertificateCounter',
  certificateCounterSchema
);
export const ReminderLog = model('ReminderLog', reminderLogSchema);
export const AuditLog = model('AuditLog', auditLogSchema);
export const Notification = model('Notification', notificationSchema);
export const RefreshSession = model('RefreshSession', refreshSessionSchema);
export const PasswordReset = model('PasswordReset', resetSchema);
export const Settings = model('Settings', settingsSchema);
export const Upload = model('Upload', uploadSchema);