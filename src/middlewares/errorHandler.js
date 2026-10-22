import { logger } from '../config/logger.js';

export const notFound = (_req, _res, next) =>
  next(
    Object.assign(new Error('Route not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    })
  );

// Pick an HTTP status for errors that don't carry an explicit statusCode
function resolveStatus(err) {
  if (err.statusCode) return err.statusCode;

  if (
    err.name === 'ValidationError' ||
    err.name === 'CastError' ||
    err.name === 'MulterError'
  ) {
    return 400;
  }

  if (err.code === 11000) return 409; // MongoDB duplicate key

  return 500;
}

export function errorHandler(err, req, res, _next) {
  const status = resolveStatus(err);
  const correlationId = req.id || req.headers['x-request-id'] || 'unavailable';

  if (status >= 500) {
    logger.error({ err, correlationId }, 'Request failed');
  }

  res.status(status).json({
    success: false,
    message: status === 500 ? 'Internal server error' : err.message,
    code: err.code || 'INTERNAL_ERROR',
    errors: err.errors || [],
    ...(status === 500 ? { correlationId } : {}),
  });
}