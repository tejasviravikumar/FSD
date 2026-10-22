import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

const unauthenticated = () =>
  new AppError(401, 'Authentication required', 'UNAUTHENTICATED');

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) throw unauthenticated();

    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    const user = await User.findOne({
      _id: payload.userId,
      status: 'active',
      deletedAt: null,
    }).select('+tokenVersion');

    if (
      !user ||
      payload.tokenVersion !== user.tokenVersion ||
      payload.role !== user.role
    ) {
      throw unauthenticated();
    }

    req.isManager = Boolean(
      await User.exists({
        managerId: user._id,
        status: 'active',
        deletedAt: null,
      })
    );
    req.user = user;
    req.user.isManager = req.isManager;

    next();
  } catch (error) {
    next(error instanceof AppError ? error : unauthenticated());
  }
}

export const allow =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthenticated());

    const hasRole = roles.includes(req.user.role);
    const isManagerEmployee =
      roles.includes('manager') &&
      req.user.role === 'employee' &&
      req.isManager;

    if (hasRole || isManagerEmployee) return next();

    next(new AppError(403, 'Forbidden', 'FORBIDDEN'));
  };