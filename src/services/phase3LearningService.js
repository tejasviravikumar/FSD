import {Assignment,AssignmentRule,Assessment,Attempt,AuditLog,Certificate,CertificateCounter,Course,Domain,ModuleProgress,Settings} from '../models/index.js';
import {AppError} from '../utils/AppError.js';
import {courseEligibilityMatches} from '../utils/courseEligibility.js';
import {matchesRule} from './phase3Service.js';

const safeQuestion=q=>({text:q.text,type:q.type,options:q.options.map(o=>({id:String(o._id),text:o.text})),marks:q.marks});
const shuffle=arr=>{for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}return arr};
export async function startAttempt(assignment,employee){
  if(assignment.status==='cancelled'||assignment.status==='completed')throw new AppError(409,'Assignment cannot start an attempt','INVALID_TRANSITION');
  const course=await Course.findById(assignment.courseId);const required=course.modules.filter(m=>m.isRequired);const complete=await ModuleProgress.countDocuments({assignmentId:assignment._id,completed:true,moduleId:{$in:required.map(m=>m._id)}});if(complete<required.length)throw new AppError(409,'Complete all required modules first','MODULES_INCOMPLETE');
  const assessment=await Assessment.findOne({courseId:course._id});if(!assessment)throw new AppError(404,'Assessment not found','NOT_FOUND');const open=await Attempt.exists({assignmentId:assignment._id,status:'open'});if(open)throw new AppError(409,'An attempt is already open','ATTEMPT_OPEN');const attemptNumber=(await Attempt.countDocuments({assignmentId:assignment._id}))+1;if(attemptNumber>course.maxAttempts)throw new AppError(409,'Maximum attempts reached','MAX_ATTEMPTS');
  const q=assessment.questions.map(question=>{const item={...safeQuestion(question),id:String(question._id)};if(assessment.shuffleOptions)item.options=shuffle(item.options);return item});if(assessment.shuffleQuestions)shuffle(q);let attempt;try{attempt=await Attempt.create({assignmentId:assignment._id,employeeId:employee._id,courseId:course._id,attemptNumber,startedAt:new Date(),answers:null,status:'open'})}catch(error){if(error.code===11000)throw new AppError(409,'An attempt is already open','ATTEMPT_OPEN');throw error}if(assignment.status==='not_started'){assignment.status='in_progress';assignment.startedAt=new Date();await assignment.save()}return {attempt,questions:q,timeLimitMinutes:assessment.timeLimitMinutes};
}
const normalizeAnswer=value=>Array.isArray(value)?value.map(String).sort():[String(value)];
export async function submitAttempt(attemptId,employee,answers){
  const attempt=await Attempt.findOne({_id:attemptId,employeeId:employee._id});if(!attempt)throw new AppError(404,'Attempt not found','NOT_FOUND');
  if(attempt.status==='timed_out')throw new AppError(422,'Assessment time limit exceeded','TIME_LIMIT');if(attempt.status==='submitted'){const certificate=await Certificate.findOne({assignmentId:attempt.assignmentId});return {attempt,certificate,duplicate:true}}
  const assignment=await Assignment.findOne({_id:attempt.assignmentId,employeeId:employee._id,status:'in_progress'});if(!assignment)throw new AppError(409,'Assignment is not active','INVALID_TRANSITION');
  const [course,assessment]=await Promise.all([Course.findById(attempt.courseId),Assessment.findOne({courseId:attempt.courseId})]);if(!assessment)throw new AppError(404,'Assessment not found','NOT_FOUND');if(assessment.timeLimitMinutes&&Date.now()-attempt.startedAt.getTime()>assessment.timeLimitMinutes*60000+30000){await Attempt.updateOne({_id:attempt._id,status:'open'},{$set:{status:'timed_out',passed:false,scorePercent:0,submittedAt:new Date()}});if(attempt.attemptNumber>=course.maxAttempts)await Assignment.updateOne({_id:attempt.assignmentId},{$set:{followUpRequired:true}});throw new AppError(422,'Assessment time limit exceeded','TIME_LIMIT')}
  if(!answers||typeof answers!=='object'||Array.isArray(answers))throw new AppError(422,'answers must map question IDs to selected option IDs','VALIDATION_ERROR');
  let total=0,earned=0;for(const q of assessment.questions){const points=Number(q.marks)||1;total+=points;const selected=normalizeAnswer(answers[String(q._id)]??[]);const correct=q.options.filter(o=>o.isCorrect).map(o=>String(o._id)).sort();if(selected.length===correct.length&&selected.every((id,i)=>id===correct[i]))earned+=points}
  const passed=total>0&&earned/total*100>=course.passMark;const submitted=await Attempt.findOneAndUpdate({_id:attempt._id,status:'open'},{$set:{answers,scorePercent:total?earned/total*100:0,passed,status:'submitted',submittedAt:new Date()}},{new:true});if(!submitted){const current=await Attempt.findById(attempt._id);if(current.status==='timed_out')throw new AppError(422,'Assessment time limit exceeded','TIME_LIMIT');return {attempt:current,certificate:await Certificate.findOne({assignmentId:attempt.assignmentId}),duplicate:true}}
  let certificate=null;if(passed){const completed=await Assignment.updateOne({_id:attempt.assignmentId,status:'in_progress'},{$set:{status:'completed',completedAt:new Date(),progressPercent:100}});if(completed.modifiedCount||await Assignment.exists({_id:attempt.assignmentId,status:'completed'}))certificate=await issueCertificate({assignmentId:attempt.assignmentId,employeeId:employee._id,course,issuedBy:employee._id})}
  else if(attempt.attemptNumber>=course.maxAttempts)await Assignment.updateOne({_id:attempt.assignmentId},{$set:{followUpRequired:true}});
  await AuditLog.create({actorId:employee._id,action:'assessment.submit',entityType:'Attempt',entityId:attempt._id,after:{scorePercent:submitted.scorePercent,passed}});return {attempt:submitted,certificate,duplicate:false,explanations:assessment.questions.map(q=>({questionId:String(q._id),explanation:q.explanation}))};
}
export async function issueCertificate({assignmentId,employeeId,course,issuedBy}){
  const existing=await Certificate.findOne({assignmentId});if(existing)return existing;const domain=await Domain.findById(course.domainId);if(!domain)throw new AppError(422,'Certificate domain is unavailable','INVALID_DOMAIN');const year=new Date().getUTCFullYear();let counter;try{counter=await CertificateCounter.findOneAndUpdate({domainId:domain._id,year},{$inc:{sequence:1}},{new:true,upsert:true,setDefaultsOnInsert:true})}catch(error){if(error.code!==11000)throw error;counter=await CertificateCounter.findOneAndUpdate({domainId:domain._id,year},{$inc:{sequence:1}},{new:true})}const code=domain.name.toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,8)||'DOMAIN';const issueDate=new Date();let expiryDate=null;if(course.validityMonths){expiryDate=new Date(issueDate);expiryDate.setUTCMonth(expiryDate.getUTCMonth()+course.validityMonths)}
  try{return await Certificate.create({assignmentId,employeeId,courseId:course._id,title:course.title,issuedBy,certificateNumber:`NEX-${code}-${year}-${String(counter.sequence).padStart(6,'0')}`,issueDate,expiryDate,status:'valid',source:'internal'})}catch(error){if(error.code!==11000)throw error;return Certificate.findOne({assignmentId})}
}
export async function repairCertificates(actor){let created=0,repaired=0;const completed=await Assignment.find({status:'completed'}).populate('courseId');for(const assignment of completed){if(!await Certificate.exists({assignmentId:assignment._id})&&assignment.courseId){await issueCertificate({assignmentId:assignment._id,employeeId:assignment.employeeId,course:assignment.courseId,issuedBy:actor._id});created++}}const certs=await Certificate.find({assignmentId:{$ne:null}});for(const cert of certs){let assignment=await Assignment.findById(cert.assignmentId);if(!assignment){const course=await Course.findById(cert.courseId);if(course){try{await Assignment.create({_id:cert.assignmentId,employeeId:cert.employeeId,courseId:course._id,courseVersion:course.version,status:'completed',progressPercent:100,completedAt:cert.issueDate,source:'onboarding'});repaired++}catch(error){if(error.code!==11000)throw error}}}else if(assignment.status!=='completed'){await Assignment.updateOne({_id:assignment._id,status:{$ne:'completed'}},{$set:{status:'completed',completedAt:cert.issueDate,progressPercent:100}});repaired++}}return {created,repaired};}
export async function getCertificateStatus(certificate,days=60){if(certificate.status==='revoked'||certificate.status==='pending_verification'||!certificate.expiryDate)return certificate.status;const soon=Number((await Settings.findOne({key:'certificateExpiringSoonDays'}))?.value??days);const remaining=(certificate.expiryDate.getTime()-Date.now())/86400000;return remaining<0?'expired':remaining<=soon?'expiring_soon':'valid'}
export async function complianceFor(employee) {
  const common = await Domain.findOne({ isCommon: true, isActive: true }).select('_id');
  const domainIds = [employee.domainId, common?._id].filter(Boolean);
  const [baseCourses, rules, assignedCourseIds] = await Promise.all([
    Course.find({ domainId: { $in: domainIds }, status: 'published', isMandatory: true }),
    AssignmentRule.find({ isActive: true }).lean(),
    Assignment.distinct('courseId', { employeeId: employee._id, status: { $ne: 'cancelled' } }),
  ]);
  const applicableRuleIds = new Set(rules.filter(rule => matchesRule(employee, rule)).map(rule => String(rule.courseId)));
  const courseMap = new Map();
  for (const course of baseCourses) if (courseEligibilityMatches(employee, course.eligibility)) courseMap.set(String(course._id), course);
  for (const courseId of assignedCourseIds) applicableRuleIds.add(String(courseId));
  if (applicableRuleIds.size) {
    const ruleCourses = await Course.find({ _id: { $in: [...applicableRuleIds] }, status: { $in: ['published', 'archived'] } });
    for (const course of ruleCourses) if (courseEligibilityMatches(employee, course.eligibility)) courseMap.set(String(course._id), course);
  }
  const items = [];
  for (const course of courseMap.values()) {
    const [assignment, certificate] = await Promise.all([
      Assignment.findOne({ employeeId: employee._id, courseId: course._id, status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }),
      Certificate.findOne({ employeeId: employee._id, courseId: course._id }).sort({ issueDate: -1 }),
    ]);
    let status = 'missing'; let certificateStatus;
    if (certificate) {
      certificateStatus = await getCertificateStatus(certificate);
      if (certificateStatus === 'valid') status = 'compliant';
      else if (certificateStatus === 'expiring_soon') status = 'expiring';
      else if (certificateStatus === 'pending_verification') status = 'in_progress';
      else status = 'overdue';
    } else if (assignment?.status === 'completed' && !course.validityMonths) status = 'compliant';
    else if (assignment?.status === 'in_progress') status = 'in_progress';
    else if (assignment?.status === 'overdue' || assignment?.dueDate && assignment.dueDate < new Date() || assignment?.status === 'completed' && course.validityMonths) status = 'overdue';
    items.push({ courseId: course._id, title: course.title, status, assignmentId: assignment?._id, certificateId: certificate?._id, certificateStatus, dueDate: assignment?.dueDate, expiryDate: certificate?.expiryDate });
  }
  const certificates = items.filter(item => item.certificateId).map(item => ({ certificateId: item.certificateId, courseId: item.courseId, title: item.title, status: item.certificateStatus, expiryDate: item.expiryDate }));
  const summary = Object.fromEntries(['compliant', 'in_progress', 'overdue', 'expiring', 'missing'].map(status => [status, items.filter(item => item.status === status).length]));
  return { userId: employee._id, mandatoryCourses: items, certificates, summary, compliant: items.every(item => item.status === 'compliant') };
}
