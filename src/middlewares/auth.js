import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

export async function authenticate(req,_res,next){
  try{
    const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;
    if(!token)throw new AppError(401,'Authentication required','UNAUTHENTICATED');
    const payload=jwt.verify(token,env.JWT_SECRET,{algorithms:['HS256'],issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE});
    const user=await User.findOne({_id:payload.userId,status:'active',deletedAt:null}).select('+tokenVersion');
    if(!user||payload.tokenVersion!==user.tokenVersion||payload.role!==user.role)throw new AppError(401,'Authentication required','UNAUTHENTICATED');
    req.isManager=Boolean(await User.exists({managerId:user._id,status:'active',deletedAt:null}));req.user=user;req.user.isManager=req.isManager;
    next();
  }catch(error){next(error instanceof AppError?error:new AppError(401,'Authentication required','UNAUTHENTICATED'))}
}
export const allow=(...roles)=>(req,_res,next)=>{if(!req.user)return next(new AppError(401,'Authentication required','UNAUTHENTICATED'));if(roles.includes(req.user.role)||roles.includes('manager')&&req.user.role==='employee'&&req.isManager)return next();next(new AppError(403,'Forbidden','FORBIDDEN'))};
