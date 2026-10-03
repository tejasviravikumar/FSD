import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {User,RefreshSession,PasswordReset,AuditLog,Settings} from '../models/index.js';
import {env} from '../config/env.js';
import {logger} from '../config/logger.js';
import {AppError} from '../utils/AppError.js';
import {mailer} from '../config/mailer.js';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export function accessToken(user){return jwt.sign({userId:user.id,role:user.role,tokenVersion:user.tokenVersion||0},env.JWT_SECRET,{algorithm:'HS256',expiresIn:'15m',issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE})}

export async function login(email,password,meta={}){
  const user=await User.findOne({email:String(email).toLowerCase(),deletedAt:null}).select('+passwordHash +loginFailures +lockUntil +tokenVersion');
  if(user?.lockUntil&&user.lockUntil>Date.now()){await AuditLog.create({actorId:user._id,action:'login.failure',entityType:'User',entityId:user._id,ip:meta.ip,userAgent:meta.userAgent});throw new AppError(401,'Invalid credentials','INVALID_CREDENTIALS')}
  if(!user||!await bcrypt.compare(password,user.passwordHash)){
    if(user){user.loginFailures=(user.loginFailures||0)+1;const failures=Number((await Settings.findOne({key:'lockoutFailures'}))?.value??5),minutes=Number((await Settings.findOne({key:'lockoutMinutes'}))?.value??15);if(user.loginFailures>=failures){const exponent=Math.min(6,Math.floor((user.loginFailures-failures)/failures));user.lockUntil=new Date(Date.now()+minutes*60_000*2**exponent)}await user.save()}
    await AuditLog.create({actorId:user?._id,action:'login.failure',entityType:'User',entityId:user?._id,ip:meta.ip,userAgent:meta.userAgent});
    throw new AppError(401,'Invalid credentials','INVALID_CREDENTIALS');
  }
  if(user.status!=='active')throw new AppError(401,'Invalid credentials','INVALID_CREDENTIALS');
  user.loginFailures=0;user.lockUntil=null;user.lastLoginAt=new Date();await user.save();
  const token=crypto.randomBytes(32).toString('base64url'),familyId=crypto.randomUUID();
  await RefreshSession.create({userId:user._id,tokenHash:digest(token),tokenVersion:user.tokenVersion||0,familyId,expiresAt:new Date(Date.now()+7*864e5),userAgent:meta.userAgent,ip:meta.ip});
  await AuditLog.create({actorId:user._id,action:'login.success',entityType:'User',entityId:user._id,ip:meta.ip,userAgent:meta.userAgent});
  return{user,accessToken:accessToken(user),refreshToken:token};
}

export async function rotate(token,meta={}){
  if(typeof token!=='string'||!token)throw new AppError(401,'Invalid refresh token','INVALID_TOKEN');
  const tokenHash=digest(token),existing=await RefreshSession.findOne({tokenHash});
  if(!existing)throw new AppError(401,'Invalid refresh token','INVALID_TOKEN');
  if(existing.usedAt){await RefreshSession.updateMany({familyId:existing.familyId},{$set:{expiresAt:new Date()}});throw new AppError(401,'Invalid refresh token','TOKEN_REUSE')}
  const now=new Date(),session=await RefreshSession.findOneAndUpdate({tokenHash,usedAt:null,expiresAt:{$gt:now}},{$set:{usedAt:now}},{new:false});
  if(!session)throw new AppError(401,'Invalid refresh token','TOKEN_EXPIRED');
  const user=await User.findById(session.userId).select('+tokenVersion');
  if(!user||user.status!=='active'||user.deletedAt||session.tokenVersion!==(user.tokenVersion||0))throw new AppError(401,'Invalid refresh token','INVALID_TOKEN');
  const refreshToken=crypto.randomBytes(32).toString('base64url');
  await RefreshSession.create({userId:user._id,tokenHash:digest(refreshToken),tokenVersion:user.tokenVersion||0,familyId:session.familyId,expiresAt:new Date(Date.now()+7*864e5),userAgent:meta.userAgent,ip:meta.ip});
  return{user,accessToken:accessToken(user),refreshToken};
}

export async function revoke(token,userId){if(token)await RefreshSession.updateOne({tokenHash:digest(token),userId,usedAt:null},{$set:{usedAt:new Date(),expiresAt:new Date()}});await AuditLog.create({actorId:userId,action:'logout',entityType:'User',entityId:userId})}
export async function revokeAll(userId){await User.updateOne({_id:userId},{$inc:{tokenVersion:1}});await RefreshSession.updateMany({userId},{$set:{expiresAt:new Date()}});await AuditLog.create({actorId:userId,action:'logout.all',entityType:'User',entityId:userId})}

export function passwordPolicy(password,user){
  const common=new Set(['password123','password1234','qwerty12345','letmein1234','welcome1234','admin123456','1234567890']);
  if(typeof password!=='string'||password.length<10||password.length>128||common.has(password.toLowerCase())||password.toLowerCase()===user.email.toLowerCase()||password.toLowerCase()===user.name.toLowerCase())throw new AppError(400,'Password does not meet policy','WEAK_PASSWORD');
}
export async function passwordChange(userId,currentPassword,newPassword){
  const user=await User.findById(userId).select('+passwordHash +tokenVersion');if(!user)throw new AppError(404,'User not found','NOT_FOUND');
  if(!await bcrypt.compare(currentPassword,user.passwordHash))throw new AppError(400,'Current password is incorrect','INVALID_PASSWORD');
  passwordPolicy(newPassword,user);user.passwordHash=await bcrypt.hash(newPassword,12);user.forcePasswordChange=false;user.tokenVersion++;await user.save();
  await RefreshSession.updateMany({userId},{$set:{expiresAt:new Date()}});await AuditLog.create({actorId:userId,action:'password.change',entityType:'User',entityId:userId});
}
export async function forgotPassword(email){
  try{
    const user=await User.findOne({email:String(email).toLowerCase(),status:'active',deletedAt:null});if(!user)return;
    const raw=crypto.randomBytes(32).toString('base64url');
    const resetFields={tokenHash:digest(raw),expiresAt:new Date(Date.now()+15*60_000),usedAt:null};
    try{await PasswordReset.updateOne({userId:user._id},{$set:resetFields},{upsert:true});}catch(error){if(error.code!==11000)throw error;await PasswordReset.updateOne({userId:user._id},{$set:resetFields});}
    await AuditLog.create({actorId:user._id,action:'password.reset.request',entityType:'User',entityId:user._id});
    const link=`${env.RESET_URL_BASE}?token=${encodeURIComponent(raw)}`;
    await mailer.send({to:user.email,subject:'Password reset',text:`Use this single-use link within 15 minutes: ${link}`});
  }catch(err){logger.error({err,action:'password.reset.failed'},'Password reset request failed')}
}
export async function resetPassword(token,password){
  if(typeof token!=='string'||!token)throw new AppError(400,'Invalid or expired reset token','INVALID_TOKEN');
  const reset=await PasswordReset.findOne({tokenHash:digest(token),usedAt:null,expiresAt:{$gt:new Date()}});if(!reset)throw new AppError(400,'Invalid or expired reset token','INVALID_TOKEN');
  const user=await User.findById(reset.userId).select('+tokenVersion');if(!user)throw new AppError(400,'Invalid or expired reset token','INVALID_TOKEN');
  passwordPolicy(password,user);const passwordHash=await bcrypt.hash(password,12),now=new Date();
  const claimed=await PasswordReset.findOneAndUpdate({_id:reset._id,usedAt:null,expiresAt:{$gt:now}},{$set:{usedAt:now}},{new:true});if(!claimed)throw new AppError(400,'Invalid or expired reset token','INVALID_TOKEN');
  const updated=await User.findOneAndUpdate({_id:user._id,status:'active',deletedAt:null,tokenVersion:user.tokenVersion},{$set:{passwordHash,forcePasswordChange:false},$inc:{tokenVersion:1}},{new:true});if(!updated)throw new AppError(400,'Invalid or expired reset token','INVALID_TOKEN');
  await RefreshSession.updateMany({userId:user._id},{$set:{expiresAt:now}});
  await AuditLog.create({actorId:user._id,action:'password.reset.complete',entityType:'User',entityId:user._id});
}
