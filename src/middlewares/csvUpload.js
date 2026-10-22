import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

// Browsers and OSes report CSV files under several MIME types
const csvMimeTypes = ['text/csv', 'application/vnd.ms-excel', 'application/csv'];

export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 1,
    parts: 2,
    fieldSize: 100,
  },
  fileFilter: (_req, file, done) => {
    const hasCsvExtension = file.originalname.toLowerCase().endsWith('.csv');
    const hasCsvMimeType = csvMimeTypes.includes(file.mimetype);
    const accepted = hasCsvExtension && hasCsvMimeType;

    done(
      accepted ? null : new AppError(400, 'Upload must be a CSV file', 'CSV_INVALID'),
      accepted
    );
  },
});