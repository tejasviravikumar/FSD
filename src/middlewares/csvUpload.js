import multer from 'multer';
import {AppError} from '../utils/AppError.js';
export const csvUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:1,parts:2,fieldSize:100},fileFilter:(_req,file,done)=>{const ext=file.originalname.toLowerCase().endsWith('.csv');const mime=['text/csv','application/vnd.ms-excel','application/csv'].includes(file.mimetype);done(ext&&mime?null:new AppError(400,'Upload must be a CSV file','CSV_INVALID'),ext&&mime)}});
