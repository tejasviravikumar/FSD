import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Allowed file extensions and the MIME types each one may carry
const allowedTypes = {
  pdf: ['application/pdf'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
};

export const courseUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 5,
    parts: 6,
  },
  fileFilter(_req, file, cb) {
    const ext = file.originalname.toLowerCase().split('.').pop();

    if (!allowedTypes[ext]?.includes(file.mimetype)) {
      return cb(
        new AppError(
          400,
          'Only PDF, JPG and PNG files are allowed',
          'INVALID_UPLOAD'
        )
      );
    }

    cb(null, true);
  },
});