import cron from 'node-cron';
import {Assignment,Certificate,Course,Domain,Notification,ReminderLog,Settings,User} from '../models/index.js';
import {evaluateRulesForEmployee} from './phase3Service.js';
import {mailer} from '../config/mailer.js';
import {validateYouTube} from './youtubeMetadataService.js';
import {logger} from '../config/logger.js';

const defaults={reminderThresholds:[90,60,30,7,0],certificateExpiringSoonDays:60,certificateRenewalDays:60};
const setting=async(key)=>((await Settings.findOne({key}))?.value??defaults[key]);
const calendarDaysUntil=(target,now)=>Math.round((Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),target.getUTCDate())-Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()))/86400000);
async function deliverOnce({key,user,title,message,type,link,entity={},daysBefore}){
 if(!user?.email)return;
 let log;
 try{log=await ReminderLog.findOneAndUpdate({dedupeKey:key},{$setOnInsert:{dedupeKey:key,userId:user._id,status:'pending',attempts:0,type,daysBefore,...entity}},{upsert:true,new:true,setDefaultsOnInsert:true})}
 catch(error){if(error.code===11000)return;throw error}
 if(log.status==='sent'||log.attempts>=3)return;
 const claimed=await ReminderLog.findOneAndUpdate({_id:log._id,$or:[{status:{$in:['pending','failed']}},{status:'sending',updatedAt:{$lt:new Date(Date.now()-5*60_000)}}],attempts:{$lt:3}},{$inc:{attempts:1},$set:{status:'sending'}},{new:true});
 if(!claimed)return;
 try{
  await Notification.updateOne({reminderKey:key},{$setOnInsert:{reminderKey:key,userId:user._id,title,message,type,link,readAt:null}},{upsert:true});
  await mailer.send({to:user.email,subject:title,text:message});
  await ReminderLog.updateOne({_id:log._id,status:'sending'},{$set:{status:'sent',sentAt:new Date(),error:null}});
 }catch(error){await ReminderLog.updateOne({_id:log._id,status:'sending'},{$set:{status:'failed',error:String(error.message).slice(0,500)}});logger.error({err:error,reminder:key},'Reminder delivery failed')}
}
export async function updateStatusesAndRenewals(){
 const now=new Date(),soon=Number(await setting('certificateExpiringSoonDays')),threshold=new Date(now.getTime()+soon*86400000);
 await Certificate.updateMany({status:{$nin:['revoked','pending_verification']},expiryDate:{$lt:now}},{$set:{status:'expired'}});
 await Certificate.updateMany({status:{$nin:['revoked','pending_verification']},expiryDate:{$gte:now,$lte:threshold}},{$set:{status:'expiring_soon'}});
 await Certificate.updateMany({status:{$nin:['revoked','pending_verification']},$or:[{expiryDate:null},{expiryDate:{$gt:threshold}}]},{$set:{status:'valid'}});
 await Assignment.updateMany({status:{$in:['not_started','in_progress']},dueDate:{$lt:now}},{$set:{status:'overdue'}});
 const employees=await User.find({role:'employee',status:'active',deletedAt:null});let created=0,skipped=0,cancelled=0;
 for(const employee of employees){const result=await evaluateRulesForEmployee(employee);created+=result.created;skipped+=result.skipped;cancelled+=result.cancelled}
 return{created,skipped,cancelled};
}
export async function sendReminders(){
 const configured=await setting('reminderThresholds'),thresholds=[...new Set(configured.map(Number).filter(x=>Number.isInteger(x)&&x>=0))],now=new Date(),soon=Number(await setting('certificateExpiringSoonDays'));
 const certificates=await Certificate.find({status:{$nin:['revoked','pending_verification']},expiryDate:{$ne:null}}).populate('employeeId');
 for(const cert of certificates){if(!cert.employeeId)continue;const days=calendarDaysUntil(cert.expiryDate,now);let threshold=days<0?'expired':thresholds.includes(days)?`day-${days}`:null;if(!threshold&&days>=0&&days<=soon&&cert.status==='expired')threshold='expired';if(!threshold)continue;
  const recipients=[{user:cert.employeeId,level:'employee'}];const overdue=-days;
  if(days<=30&&cert.employeeId.managerId){const manager=await User.findById(cert.employeeId.managerId);if(manager)recipients.push({user:manager,level:'manager'})}
  if(overdue>14&&cert.employeeId.domainId){const domain=await Domain.findById(cert.employeeId.domainId),head=domain?.headId?await User.findById(domain.headId):null;if(head)recipients.push({user:head,level:'head'})}
  for(const {user,level} of recipients)await deliverOnce({key:`certificate:${cert._id}:${threshold}:${level}`,user,title:days<0?'Certificate expired':'Certificate expiry reminder',message:days<0?`Your certificate ${cert.title||''} has expired.`:`Your certificate ${cert.title||''} expires in ${days} day(s).`,type:days<0?'certificate_expired':'certificate_expiring',link:'/certificates/me',entity:{certificateId:cert._id,employeeId:cert.employeeId._id},daysBefore:days});
 }
 const assignments=await Assignment.find({status:{$in:['not_started','in_progress','overdue']},dueDate:{$ne:null,$lte:new Date(now.getTime()+Math.max(90,...thresholds)*86400000)}}).populate('employeeId courseId');
 for(const assignment of assignments){const employee=assignment.employeeId;if(!employee)continue;const days=calendarDaysUntil(assignment.dueDate,now),overdue=-days;if(days>Math.max(90,...thresholds))continue;
  let threshold=days<0&&overdue%7===0?`overdue-week-${Math.floor(overdue/7)}`:days>=0&&thresholds.includes(days)?`day-${days}`:null;if(!threshold)continue;
  const recipients=[{user:employee,level:'employee'}];
  if(days<=30&&employee.managerId){const manager=await User.findById(employee.managerId);if(manager)recipients.push({user:manager,level:'manager'})}
  if(overdue>14&&employee.domainId){const domain=await Domain.findById(employee.domainId),head=domain?.headId?await User.findById(domain.headId):null;if(head)recipients.push({user:head,level:'head'})}
  const label=assignment.courseId?.title||'training assignment';for(const {user,level} of recipients)await deliverOnce({key:`assignment:${assignment._id}:${threshold}:${level}`,user,title:days<0?'Overdue training reminder':'Training due date reminder',message:days<0?`${label} is overdue by ${overdue} day(s).`:`${label} is due in ${days} day(s).`,type:'assignment_reminder',link:user._id.equals(employee._id)?'/assignments/me':'/assignments',entity:{assignmentId:assignment._id,employeeId:employee._id,escalatedTo:level==='employee'?undefined:user._id},daysBefore:days});
 }
 return{certificates:certificates.length,assignments:assignments.length};
}
export async function checkYouTubeModules(){
 const courses=await Course.find({status:'published','modules.type':'youtube'});let notified=0;
 for(const course of courses)for(const module of course.modules.filter(m=>m.type==='youtube')){try{const result=await validateYouTube({url:`https://www.youtube.com/watch?v=${module.youtubeVideoId}`});if(result.embeddable===false)throw new Error('Video is no longer embeddable')}
  catch(error){const trainer=await User.findById(course.trainerId);if(trainer){await deliverOnce({key:`youtube:${course._id}:${module._id}:broken`,user:trainer,title:'YouTube course module needs attention',message:`The video module "${module.title}" in "${course.title}" is unavailable or cannot be embedded.`,type:'youtube_unavailable',link:`/courses/${course._id}`,entity:{employeeId:trainer._id}});notified++}}
 }
 return{courses:courses.length,notified};
}
export const jobRunners={nightly:updateStatusesAndRenewals,reminders:sendReminders,youtube:checkYouTubeModules};
let schedules=[];
export function startJobs(){if(schedules.length)return;schedules=[cron.schedule('15 1 * * *',()=>updateStatusesAndRenewals().catch(error=>logger.error({err:error},'Nightly learning job failed')),{timezone:process.env.TIMEZONE||'Asia/Kolkata'}),cron.schedule('0 9 * * *',()=>sendReminders().catch(error=>logger.error({err:error},'Reminder job failed')),{timezone:process.env.TIMEZONE||'Asia/Kolkata'}),cron.schedule('0 8 * * 1',()=>checkYouTubeModules().catch(error=>logger.error({err:error},'YouTube availability job failed')),{timezone:process.env.TIMEZONE||'Asia/Kolkata'})];}
export function stopJobs(){for(const job of schedules)job.stop();schedules=[];}
