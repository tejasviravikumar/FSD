import { AppError } from '../utils/AppError.js';

const PARTS = ['body', 'query', 'params'];

export const validate = (schemas) => (req, _res, next) => {
  for (const key of PARTS) {
    if (!schemas[key]) continue;

    const result = schemas[key].safeParse(req[key]);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      return next(
        new AppError(400, 'Validation failed', 'VALIDATION_ERROR', errors)
      );
    }

    // Replace the raw input with the parsed (coerced and cleaned) data
    req[key] = result.data;
  }

  next();
};