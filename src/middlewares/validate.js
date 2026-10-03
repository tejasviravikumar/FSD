import { AppError } from '../utils/AppError.js';
export const validate=schemas=>(req,_res,next)=>{for(const key of ['body','query','params'])if(schemas[key]){const r=schemas[key].safeParse(req[key]);if(!r.success)return next(new AppError(400,'Validation failed','VALIDATION_ERROR',r.error.issues.map(i=>({field:i.path.join('.'),message:i.message}))));req[key]=r.data}next()};
