import bcrypt from 'bcryptjs';
import {z} from 'zod';
import {Domain,User} from '../models/index.js';
import {AppError} from '../utils/AppError.js';
import {passwordPolicy} from './authService.js';
import {evaluateRulesForEmployee} from './phase3Service.js';

function parseRow(line){const values=[];let field='',quoted=false;for(let i=0;i<line.length;i++){const char=line[i];if(char==='"'&&line[i+1]==='"'&&quoted){field+='"';i++}else if(char==='"')quoted=!quoted;else if(char===','&&!quoted){values.push(field);field=''}else field+=char}if(quoted)throw new AppError(400,'Malformed CSV quoting','CSV_INVALID');values.push(field);return values}

export async function importUsersCsv(csv,actor){
  if(typeof csv!=='string'||csv.includes('\0'))throw new AppError(400,'Invalid CSV content','CSV_INVALID');
  const lines=csv.split(/\r?\n/).filter(line=>line.length>0);if(lines.length<2)throw new AppError(400,'CSV requires a header and at least one row');if(lines.length>1001)throw new AppError(400,'CSV is limited to 1000 data rows');
  const headers=parseRow(lines[0]).map(value=>value.trim().toLowerCase());if(new Set(headers).size!==headers.length)throw new AppError(400,'CSV headers must be unique','CSV_INVALID');
  if(['name','email','password'].some(field=>!headers.includes(field)))throw new AppError(400,'CSV headers must include name,email,password','CSV_INVALID');
  const rows=[],errors=[];
  for(let index=1;index<lines.length;index++){
    try{const values=parseRow(lines[index]);if(values.length!==headers.length)throw new Error('Column count does not match header');const input=Object.fromEntries(headers.map((key,i)=>[key,values[i].trim()]));
      const name=z.string().min(1).max(120).parse(input.name),email=z.string().email().max(254).parse(input.email).toLowerCase(),password=input.password;passwordPolicy(password,{name,email});
      const role=input.role||'employee';if(!['admin','trainer','employee'].includes(role))throw new Error('role must be admin, trainer or employee');
      for(const field of ['domainId','managerId'])if(input[field]&&!/^[a-f\d]{24}$/i.test(input[field]))throw new Error(`${field} must be a MongoDB ObjectId`);
      rows.push({row:index+1,input:{name,email,password,role,domainId:input.domainId||undefined,managerId:input.managerId||undefined,phone:input.phone||undefined,designation:input.designation||undefined,level:input.level||undefined,location:input.location||undefined,joinedOn:input.joinedOn||undefined}});
    }catch(error){errors.push({row:index+1,message:error.message})}
  }
  const seen=new Set(),valid=[];for(const row of rows){if(seen.has(row.input.email)){errors.push({row:row.row,message:'Duplicate email in CSV'});continue}seen.add(row.input.email);valid.push(row)}
  const [existing,domains,managers]=await Promise.all([
    User.find({email:{$in:valid.map(row=>row.input.email)}}).distinct('email'),
    Domain.find({_id:{$in:valid.map(row=>row.input.domainId).filter(Boolean)},isActive:true}).distinct('_id'),
    User.find({_id:{$in:valid.map(row=>row.input.managerId).filter(Boolean)},role:'employee',status:'active',deletedAt:null}).distinct('_id')
  ]);
  const duplicateEmails=new Set(existing),activeDomains=new Set(domains.map(String)),activeManagers=new Set(managers.map(String)),invalidReferences=new Set();
  for(const row of valid){if(row.input.domainId&&!activeDomains.has(row.input.domainId)){errors.push({row:row.row,message:'Domain does not exist or is inactive'});invalidReferences.add(row.row)}if(row.input.managerId&&!activeManagers.has(row.input.managerId)){errors.push({row:row.row,message:'Manager does not exist or is inactive'});invalidReferences.add(row.row)}}
  const pending=[];for(const row of valid){if(duplicateEmails.has(row.input.email))errors.push({row:row.row,message:'Email already exists'});else if(!invalidReferences.has(row.row))pending.push(row)}
  const docs=await Promise.all(pending.map(async row=>({row,doc:{name:row.input.name,email:row.input.email,phone:row.input.phone,passwordHash:await bcrypt.hash(row.input.password,12),role:row.input.role,domainId:row.input.domainId,managerId:row.input.managerId,designation:row.input.designation,level:row.input.level,location:row.input.location,joinedOn:row.input.joinedOn,forcePasswordChange:false}})));
  let created=0;
  if(docs.length){try{const inserted=await User.insertMany(docs.map(x=>x.doc),{ordered:false});created=inserted.length;await auditCreatedUsers(inserted,actor)}catch(error){created=error.insertedDocs?.length||0;for(const e of error.writeErrors||[]){const row=docs[e.index]?.row;errors.push({row:row?.row||0,message:e.code===11000?'Email already exists':e.errmsg||'Invalid user row'})}if(!error.writeErrors)throw error;await auditCreatedUsers(error.insertedDocs||[],actor)}}
  return{created,errors,received:lines.length-1,status:200};
}

async function auditCreatedUsers(users,actor){
  const {AuditLog}=await import('../models/index.js');
  if(users.length){await AuditLog.insertMany(users.map(user=>({actorId:actor._id,action:'user.create',entityType:'User',entityId:user._id,after:{name:user.name,email:user.email,role:user.role}})),{ordered:false});for(const user of users)if(user.role==='employee')await evaluateRulesForEmployee(user)}
}

