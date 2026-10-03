import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
const allowedOrigins=env.CORS_ORIGINS.split(',').map(x=>x.trim()).filter(Boolean);
export function csrfProtection(req,_res,next){const sources=[req.get('origin'),req.get('referer')].filter(Boolean);let valid=sources.length>0;for(const source of sources){try{if(!allowedOrigins.includes(new URL(source).origin))valid=false}catch{valid=false}}if(!valid||req.get('x-requested-with')!=='XMLHttpRequest')return next(new AppError(403,'CSRF validation failed','CSRF_FAILED'));next()}
