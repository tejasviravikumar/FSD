import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  User,
  RefreshSession,
  PasswordReset,
  AuditLog,
  Settings,
} from '../models/index.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import { mailer } from '../config/mailer.js';

const REFRESH_TTL_MS = 7 * 864e5; // 7 days

const digest = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');

// Read a numeric admin setting, falling back to a default
const numericSetting = async (key, fallback) =>
  Number((await Settings.findOne({ key }))?.value ?? fallback);

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

export function accessToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion || 0,
    },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '15m',
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }
  );
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(email, password, meta = {}) {
  const user = await User.findOne({
    email: String(email).toLowerCase(),
    deletedAt: null,
  }).select('+passwordHash +loginFailures +lockUntil +tokenVersion');

  // Locked account: log the attempt and reject without checking the password
  if (user?.lockUntil && user.lockUntil > Date.now()) {
    await AuditLog.create({
      actorId: user._id,
      action: 'login.failure',
      entityType: 'User',
      entityId: user._id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  // Unknown user or wrong password
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    if (user) {
      user.loginFailures = (user.loginFailures || 0) + 1;

      const failures = await numericSetting('lockoutFailures', 5);
      const minutes = await numericSetting('lockoutMinutes', 15);

      // Lock the account, doubling the lock time for each further round of failures
      if (user.loginFailures >= failures) {
        const exponent = Math.min(
          6,
          Math.floor((user.loginFailures - failures) / failures)
        );
        user.lockUntil = new Date(Date.now() + minutes * 60_000 * 2 ** exponent);
      }

      await user.save();
    }

    await AuditLog.create({
      actorId: user?._id,
      action: 'login.failure',
      entityType: 'User',
      entityId: user?._id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  if (user.status !== 'active') {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  // Success: reset failure counters
  user.loginFailures = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  // Start a new refresh-token family
  const token = crypto.randomBytes(32).toString('base64url');
  const familyId = crypto.randomUUID();

  await RefreshSession.create({
    userId: user._id,
    tokenHash: digest(token),
    tokenVersion: user.tokenVersion || 0,
    familyId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  await AuditLog.create({
    actorId: user._id,
    action: 'login.success',
    entityType: 'User',
    entityId: user._id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { user, accessToken: accessToken(user), refreshToken: token };
}

// ---------------------------------------------------------------------------
// Refresh-token rotation
// ---------------------------------------------------------------------------

export async function rotate(token, meta = {}) {
  if (typeof token !== 'string' || !token) {
    throw new AppError(401, 'Invalid refresh token', 'INVALID_TOKEN');
  }

  const tokenHash = digest(token);
  const existing = await RefreshSession.findOne({ tokenHash });

  if (!existing) {
    throw new AppError(401, 'Invalid refresh token', 'INVALID_TOKEN');
  }

  // A token that was already used means it may have been stolen:
  // expire every session in the same family
  if (existing.usedAt) {
    await RefreshSession.updateMany(
      { familyId: existing.familyId },
      { $set: { expiresAt: new Date() } }
    );
    throw new AppError(401, 'Invalid refresh token', 'TOKEN_REUSE');
  }

  // Claim the token atomically so it can only be used once
  const now = new Date();
  const session = await RefreshSession.findOneAndUpdate(
    { tokenHash, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: false }
  );

  if (!session) {
    throw new AppError(401, 'Invalid refresh token', 'TOKEN_EXPIRED');
  }

  const user = await User.findById(session.userId).select('+tokenVersion');

  if (
    !user ||
    user.status !== 'active' ||
    user.deletedAt ||
    session.tokenVersion !== (user.tokenVersion || 0)
  ) {
    throw new AppError(401, 'Invalid refresh token', 'INVALID_TOKEN');
  }

  // Issue the next token in the same family
  const refreshToken = crypto.randomBytes(32).toString('base64url');

  await RefreshSession.create({
    userId: user._id,
    tokenHash: digest(refreshToken),
    tokenVersion: user.tokenVersion || 0,
    familyId: session.familyId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  return { user, accessToken: accessToken(user), refreshToken };
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function revoke(token, userId) {
  if (token) {
    await RefreshSession.updateOne(
      { tokenHash: digest(token), userId, usedAt: null },
      { $set: { usedAt: new Date(), expiresAt: new Date() } }
    );
  }

  await AuditLog.create({
    actorId: userId,
    action: 'logout',
    entityType: 'User',
    entityId: userId,
  });
}

export async function revokeAll(userId) {
  // Bumping tokenVersion invalidates every issued access token
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  await RefreshSession.updateMany(
    { userId },
    { $set: { expiresAt: new Date() } }
  );

  await AuditLog.create({
    actorId: userId,
    action: 'logout.all',
    entityType: 'User',
    entityId: userId,
  });
}

// ---------------------------------------------------------------------------
// Password policy and changes
// ---------------------------------------------------------------------------

export function passwordPolicy(password, user) {
  const common = new Set([
    'password123',
    'password1234',
    'qwerty12345',
    'letmein1234',
    'welcome1234',
    'admin123456',
    '1234567890',
  ]);

  if (
    typeof password !== 'string' ||
    password.length < 10 ||
    password.length > 128 ||
    common.has(password.toLowerCase()) ||
    password.toLowerCase() === user.email.toLowerCase() ||
    password.toLowerCase() === user.name.toLowerCase()
  ) {
    throw new AppError(400, 'Password does not meet policy', 'WEAK_PASSWORD');
  }
}

export async function passwordChange(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select('+passwordHash +tokenVersion');
  if (!user) throw new AppError(404, 'User not found', 'NOT_FOUND');

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError(400, 'Current password is incorrect', 'INVALID_PASSWORD');
  }

  passwordPolicy(newPassword, user);

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.forcePasswordChange = false;
  user.tokenVersion++;
  await user.save();

  // Sign out all other sessions
  await RefreshSession.updateMany(
    { userId },
    { $set: { expiresAt: new Date() } }
  );

  await AuditLog.create({
    actorId: userId,
    action: 'password.change',
    entityType: 'User',
    entityId: userId,
  });
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

// Never reveals whether the account exists: errors are logged, not thrown
export async function forgotPassword(email) {
  try {
    const user = await User.findOne({
      email: String(email).toLowerCase(),
      status: 'active',
      deletedAt: null,
    });
    if (!user) return;

    const raw = crypto.randomBytes(32).toString('base64url');
    const resetFields = {
      tokenHash: digest(raw),
      expiresAt: new Date(Date.now() + 15 * 60_000),
      usedAt: null,
    };

    // One reset record per user; retry once if two requests race on the upsert
    try {
      await PasswordReset.updateOne(
        { userId: user._id },
        { $set: resetFields },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      await PasswordReset.updateOne({ userId: user._id }, { $set: resetFields });
    }

    await AuditLog.create({
      actorId: user._id,
      action: 'password.reset.request',
      entityType: 'User',
      entityId: user._id,
    });

    const link = `${env.RESET_URL_BASE}?token=${encodeURIComponent(raw)}`;

    await mailer.send({
      to: user.email,
      subject: 'Password reset',
      text: `Use this single-use link within 15 minutes: ${link}`,
    });
  } catch (err) {
    logger.error(
      { err, action: 'password.reset.failed' },
      'Password reset request failed'
    );
  }
}

export async function resetPassword(token, password) {
  const invalid = () =>
    new AppError(400, 'Invalid or expired reset token', 'INVALID_TOKEN');

  if (typeof token !== 'string' || !token) throw invalid();

  const reset = await PasswordReset.findOne({
    tokenHash: digest(token),
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!reset) throw invalid();

  const user = await User.findById(reset.userId).select('+tokenVersion');
  if (!user) throw invalid();

  passwordPolicy(password, user);

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  // Claim the reset token atomically so it can only be used once
  const claimed = await PasswordReset.findOneAndUpdate(
    { _id: reset._id, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: true }
  );
  if (!claimed) throw invalid();

  // Update the password only if the user hasn't changed since we loaded them
  const updated = await User.findOneAndUpdate(
    {
      _id: user._id,
      status: 'active',
      deletedAt: null,
      tokenVersion: user.tokenVersion,
    },
    {
      $set: { passwordHash, forcePasswordChange: false },
      $inc: { tokenVersion: 1 },
    },
    { new: true }
  );
  if (!updated) throw invalid();

  await RefreshSession.updateMany(
    { userId: user._id },
    { $set: { expiresAt: now } }
  );

  await AuditLog.create({
    actorId: user._id,
    action: 'password.reset.complete',
    entityType: 'User',
    entityId: user._id,
  });
}