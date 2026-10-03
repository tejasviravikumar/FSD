import multer from 'multer';
import { AppError } from '../utils/AppError.js';
export const courseUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:5,parts:6},fileFilter(_req,file,cb){const ext=file.originalname.toLowerCase().split('.').pop();const allowed={pdf:['application/pdf'],jpg:['image/jpeg'],jpeg:['image/jpeg'],png:['image/png']};if(!allowed[ext]?.includes(file.mimetype))return cb(new AppError(400,'Only PDF, JPG and PNG files are allowed','INVALID_UPLOAD'));cb(null,true);}});
