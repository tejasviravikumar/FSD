import { Assignment, AssignmentRule, AuditLog, Certificate, Course, Domain, Notification, Settings, User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

const allowedOperators={domainId:['eq','in','not_in'],role:['eq','in','not_in'],designation:['eq','in','not_in'],level:['eq','in','not_in'],location:['eq','in','not_in'],tag:['eq','in','not_in'],joinedWithinDays:['gte','lte']};
export function validateRule(input){
  if(!Array.isArray(input.conditions)||input.conditions.length>20)throw new AppError(422,'conditions must contain at most 20 entries','VALIDATION_ERROR');
  for(const [i,c] of input.conditions.entries()){
    if(!c||!allowedOperators[c.field]?.includes(c.operator))throw new AppError(422,`Invalid operator for condition ${i}`,'VALIDATION_ERROR');
    const list=['in','not_in'].includes(c.operator);if(list?(!Array.isArray(c.value)||!c.value.length||c.value.length>100):c.value===undefined)throw new AppError(422,`Invalid value for condition ${i}`,'VALIDATION_ERROR');
    if(list&&c.value.some(v=>typeof v!=='string')||!list&&c.field!=='joinedWithinDays'&&typeof c.value!=='string'||c.field==='joinedWithinDays'&&typeof c.value!=='number')throw new AppError(422,`Invalid value type for condition ${i}`,'VALIDATION_ERROR');
    if(c.field==='domainId'&&(Array.isArray(c.value)?c.value:[c.value]).some(v=>! /^[a-f\d]{24}$/i.test(v)))throw new AppError(422,'domainId conditions require ObjectIds','VALIDATION_ERROR');
    if(c.field==='joinedWithinDays'&&((list?c.value:[c.value]).some(v=>!Number.isInteger(v)||v<0||v>36500)))throw new AppError(422,'joinedWithinDays values must be integers from 0 to 36500','VALIDATION_ERROR');
  }
  const recurrence=input.recurrence??{type:'none'};if(!['none','annual','custom'].includes(recurrence.type)||recurrence.type==='custom'&&(!Number.isInteger(recurrence.months)||recurrence.months<1||recurrence.months>120))throw new AppError(422,'Invalid recurrence','VALIDATION_ERROR');
  return {...input,recurrence};
}
const conditionMatches=(employee,c)=>{
  let value=employee[c.field];if(c.field==='joinedWithinDays'){value=employee.joinedOn?Math.floor((Date.now()-new Date(employee.joinedOn).getTime())/86400000):null;if(value===null)return false}
  if(c.field==='tag')value=employee.tags||[];
  const candidate=String(value??'');const list=Array.isArray(c.value)?c.value:[c.value];const match=list.some(v=>String(v)===candidate||(Array.isArray(value)&&value.some(x=>String(x)===String(v))));
  switch(c.operator){case'eq':return match;case'in':return match;case'not_in':return !match;case'gte':return Number(value)>=Number(c.value);case'lte':return Number(value)<=Number(c.value);default:return false}
};
export function matchesRule(employee,rule){const outcomes=(rule.conditions||[]).map(c=>conditionMatches(employee,c));return rule.matchType==='any'?outcomes.some(Boolean):outcomes.every(Boolean)}
const cycleFor=rule=>{const type=rule.recurrence?.type;if(type==='none'||!type)return'none';const now=new Date();if(type==='annual')return`annual:${now.getUTCFullYear()}`;const months=rule.recurrence.months||12;return`custom:${Math.floor((now.getUTCFullYear()*12+now.getUTCMonth())/months)}`};
const dueDateFor=days=>days===undefined?undefined:new Date(Date.now()+days*86400000);
async function upsertAssignment({employee,course,source,ruleId,dueInDays,cycle='none',actorId}){
  const identity={employeeId:employee._id,courseId:course._id,courseVersion:course.version,cycle,status:{$ne:'cancelled'}};
  if(await Assignment.exists(identity))return false;
  try{const assignment=await Assignment.create({employeeId:employee._id,courseId:course._id,courseVersion:course.version,cycle,source,ruleId,dueDate:dueDateFor(dueInDays),assignedBy:actorId});await Notification.updateOne({reminderKey:`assignment:new:${assignment._id}`},{$setOnInsert:{reminderKey:`assignment:new:${assignment._id}`,userId:employee._id,title:'New training assignment',message:`${course.title} has been assigned to you.`,type:'assignment_created',link:'/assignments/me'}},{upsert:true});return true}
  catch(error){if(error.code===11000)return false;throw error}
}
export async function evaluateRulesForEmployee(employee){
  const rules=await AssignmentRule.find({isActive:true}).lean();const desired=new Map();
  const common=await Domain.findOne({isCommon:true,isActive:true}).select('_id').lean();
  if(common){const courses=await Course.find({domainId:common._id,status:'published',isMandatory:true}).lean();for(const course of courses)desired.set(`${course._id}:none`,{course,source:'onboarding',cycle:'none'})}
  for(const rule of rules){if(!matchesRule(employee,rule))continue;const course=await Course.findOne({_id:rule.courseId,status:'published'}).lean();if(course)desired.set(`${course._id}:${cycleFor(rule)}`,{course,source:'rule',ruleId:rule._id,dueInDays:rule.dueInDays,cycle:cycleFor(rule)})}
  const renewalDays=Number((await Settings.findOne({key:'certificateRenewalDays'}))?.value??60);const renewals=await Certificate.find({employeeId:employee._id,source:'internal',expiryDate:{$gte:new Date(),$lte:new Date(Date.now()+renewalDays*86400000)}});for(const cert of renewals){const course=await Course.findOne({_id:cert.courseId,status:'published'}).lean();if(course){const cycle=`renewal:${cert._id}`;desired.set(`${course._id}:${cycle}`,{course,source:'expiry_renewal',cycle,dueInDays:Math.max(0,Math.ceil((cert.expiryDate-Date.now())/86400000))})}}
  let created=0,skipped=0,cancelled=0;
  const existingRules=await Assignment.find({employeeId:employee._id,source:'rule',status:'not_started'});
  for(const assignment of existingRules){const rule=rules.find(x=>String(x._id)===String(assignment.ruleId));const isDesired=rule&&matchesRule(employee,rule)&&desired.has(`${assignment.courseId}:${cycleFor(rule)}`);if(!isDesired){const res=await Assignment.updateOne({_id:assignment._id,status:'not_started',source:'rule'},{$set:{status:'cancelled'}});cancelled+=res.modifiedCount||0}}
  for(const item of desired.values()){if(await upsertAssignment({employee,actorId:null,...item}))created++;else skipped++}
  return {created,skipped,cancelled};
}
export async function previewRule(rule){const employees=await User.find({role:'employee',status:'active',deletedAt:null}).select('_id name email role domainId designation level location joinedOn tags');return employees.filter(employee=>matchesRule(employee,rule))}
export async function createRule(input,actor){
  const valid=validateRule(input),course=await Course.findOne({_id:valid.courseId,status:'published'});if(!course)throw new AppError(422,'Rule target must be a published course','INVALID_COURSE');
  const rule=await AssignmentRule.create(valid);await AuditLog.create({actorId:actor._id,action:'rule.create',entityType:'AssignmentRule',entityId:rule._id,after:{courseId:rule.courseId,isActive:rule.isActive}});
  if(rule.isActive){const employees=await User.find({role:'employee',status:'active',deletedAt:null});for(const employee of employees)await evaluateRulesForEmployee(employee)}return rule;
}
export async function updateRule(id,input,actor){
  const rule=await AssignmentRule.findById(id);if(!rule)throw new AppError(404,'Rule not found','NOT_FOUND');const before=rule.toObject();const merged=validateRule({...rule.toObject(),...input});
  if(input.courseId||rule.courseId){const course=await Course.findOne({_id:merged.courseId,status:'published'});if(!course)throw new AppError(422,'Rule target must be a published course','INVALID_COURSE')}
  for(const key of ['name','courseId','isActive','conditions','matchType','recurrence','dueInDays'])if(merged[key]!==undefined)rule[key]=merged[key];await rule.save();await AuditLog.create({actorId:actor._id,action:'rule.update',entityType:'AssignmentRule',entityId:rule._id,before:{isActive:before.isActive,courseId:before.courseId},after:{isActive:rule.isActive,courseId:rule.courseId}});
  if(rule.isActive||before.isActive){const employees=await User.find({role:'employee',status:'active',deletedAt:null});for(const employee of employees)await evaluateRulesForEmployee(employee)}return rule;
}
export async function deleteRule(id,actor){const rule=await AssignmentRule.findByIdAndDelete(id);if(!rule)throw new AppError(404,'Rule not found','NOT_FOUND');await Assignment.updateMany({ruleId:rule._id,source:'rule',status:'not_started'},{$set:{status:'cancelled'}});await AuditLog.create({actorId:actor._id,action:'rule.delete',entityType:'AssignmentRule',entityId:rule._id,before:{courseId:rule.courseId}});return true}
export async function runRules(){const employees=await User.find({role:'employee',status:'active',deletedAt:null});const counts={created:0,skipped:0,cancelled:0};for(const employee of employees){const result=await evaluateRulesForEmployee(employee);for(const k of Object.keys(counts))counts[k]+=result[k]}return counts}
export async function createManualAssignment({employeeId,courseId,dueDate},actor){
  const employee=await User.findOne({_id:employeeId,role:'employee',status:'active',deletedAt:null});if(!employee)throw new AppError(404,'Employee not found','NOT_FOUND');
  if(actor.role==='employee'&&actor.isManager&&String(employee.managerId)!==String(actor._id))throw new AppError(404,'Employee not found','NOT_FOUND');
  const course=await Course.findOne({_id:courseId,status:'published'});if(!course)throw new AppError(404,'Published course not found','NOT_FOUND');
  const identity={employeeId:employee._id,courseId:course._id,cycle:'none',status:{$ne:'cancelled'},$or:[{courseVersion:course.version},{courseVersion:null}]};const existing=await Assignment.findOne(identity);if(existing){if(existing.courseVersion==null){existing.courseVersion=course.version;await existing.save()}return {assignment:existing,created:false}}
  try{const assignment=await Assignment.create({employeeId:employee._id,courseId:course._id,courseVersion:course.version,cycle:'none',dueDate:dueDate?new Date(dueDate):undefined,source:'manual',assignedBy:actor._id});await Notification.updateOne({reminderKey:`assignment:new:${assignment._id}`},{$setOnInsert:{reminderKey:`assignment:new:${assignment._id}`,userId:employee._id,title:'New training assignment',message:`${course.title} has been assigned to you.`,type:'assignment_created',link:'/assignments/me'}},{upsert:true});await AuditLog.create({actorId:actor._id,action:'assignment.create',entityType:'Assignment',entityId:assignment._id,after:{employeeId:employee._id,courseId:course._id}});return {assignment,created:true}}
  catch(error){if(error.code!==11000)throw error;const assignment=await Assignment.findOne({employeeId:employee._id,courseId:course._id,cycle:'none',status:{$ne:'cancelled'},$or:[{courseVersion:course.version},{courseVersion:null}]});if(assignment)return {assignment,created:false};throw error}
}
