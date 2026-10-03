import {test,expect,beforeAll,afterAll} from '@jest/globals';
import request from 'supertest';
import {MongoMemoryServer} from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

let mongod,app,models,env,admin,employee,adminToken,employeeToken,domain;
const password='Sufficient-Strong-Secret-42!';
const userPayload=(name,email,role='employee',extra={})=>({name,email,passwordHash:bcrypt.hashSync(password,12),role,status:'active',...extra});
const token=user=>jwt.sign({userId:String(user._id),role:user.role,tokenVersion:user.tokenVersion||0},env.JWT_SECRET,{algorithm:'HS256',expiresIn:'15m',issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE});
const auth=value=>({Authorization:`Bearer ${value}`});
beforeAll(async()=>{process.env.NODE_ENV='test';process.env.MONGODB_URI='mongodb://127.0.0.1:27017/ignored';process.env.JWT_SECRET='phase-three-unit-test-secret-at-least-32-characters';process.env.CORS_ORIGINS='http://localhost:5173';process.env.MAILER_TRANSPORT='console';mongod=await MongoMemoryServer.create();process.env.MONGODB_URI=mongod.getUri();({app}=await import('../src/app.js'));models=await import('../src/models/index.js');env=(await import('../src/config/env.js')).env;await mongoose.connect(mongod.getUri());domain=await models.Domain.create({name:'phase-three-domain'});admin=await models.User.create(userPayload('Phase Three Admin','p3-admin@nexora.test','admin'));employee=await models.User.create(userPayload('Phase Three Employee','p3-employee@nexora.test','employee',{domainId:domain._id,designation:'engineer',level:'mid',location:'Pune',tags:['security']}));adminToken=token(admin);employeeToken=token(employee)},60000);
afterAll(async()=>{await mongoose.disconnect();if(mongod)await mongod.stop()});

test('assignment rule preview is read-only and repeated runs stay idempotent',async()=>{
  const course=await models.Course.create({title:'Rule course',domainId:domain._id,trainerId:admin._id,status:'published'});
  const create=await request(app).post('/api/v1/rules').set(auth(adminToken)).send({name:'Mid engineers',courseId:String(course._id),conditions:[{field:'level',operator:'eq',value:'mid'},{field:'tag',operator:'in',value:['security']}],matchType:'all',recurrence:{type:'none'},dueInDays:20});expect(create.status).toBe(200);
  const countBeforePreview=await models.Assignment.countDocuments({employeeId:employee._id,courseId:course._id});const preview=await request(app).post(`/api/v1/rules/${create.body.data._id}/preview`).set(auth(adminToken));expect(preview.status).toBe(200);expect(preview.body.data.map(x=>x.email)).toContain(employee.email);expect(await models.Assignment.countDocuments({employeeId:employee._id,courseId:course._id})).toBe(countBeforePreview);
  const first=await request(app).post('/api/v1/rules/run').set(auth(adminToken));const second=await request(app).post('/api/v1/rules/run').set(auth(adminToken));expect(first.body.data.created).toBe(0);expect(second.body.data.created).toBe(0);expect(await models.Assignment.countDocuments({employeeId:employee._id,courseId:course._id,status:{$ne:'cancelled'}})).toBe(1);
  const invalid=await request(app).post('/api/v1/rules').set(auth(adminToken)).send({name:'Bad operator',courseId:String(course._id),conditions:[{field:'joinedWithinDays',operator:'eq',value:5}]});expect(invalid.status).toBe(422);
});

test('module completion gates attempts and concurrent passing submits issue one certificate',async()=>{
  const course=await models.Course.create({title:'Assessment course',domainId:domain._id,trainerId:admin._id,status:'published',validityMonths:12,maxAttempts:2,passMark:70,modules:[{title:'Read this',type:'note',notes:'Course notes',isRequired:true}]});
  const assignment=await models.Assignment.create({employeeId:employee._id,courseId:course._id,courseVersion:course.version,source:'manual'});
  const choice=await models.Assessment.create({courseId:course._id,questions:[{text:'Choose the safe option',type:'single_choice',marks:1,explanation:'Use the secure option.',options:[{text:'Safe',isCorrect:true},{text:'Unsafe',isCorrect:false}]}],timeLimitMinutes:5});
  const denied=await request(app).post(`/api/v1/assignments/${assignment.id}/attempts`).set(auth(employeeToken));expect(denied.status).toBe(409);
  const complete=await request(app).post(`/api/v1/assignments/${assignment.id}/modules/${course.modules[0]._id}/complete`).set(auth(employeeToken));expect(complete.status).toBe(200);
  const start=await request(app).post(`/api/v1/assignments/${assignment.id}/attempts`).set(auth(employeeToken));expect(start.status).toBe(200);expect(start.body.data.questions[0].options.every(x=>!('isCorrect'in x))).toBe(true);expect(start.body.data.questions[0].explanation).toBeUndefined();
  const question=choice.questions[0],right=question.options.find(x=>x.isCorrect);const submit=()=>request(app).post(`/api/v1/attempts/${start.body.data.attempt._id}/submit`).set(auth(employeeToken)).send({answers:{[question._id]:String(right._id)}});const responses=await Promise.all([submit(),submit()]);expect(responses.every(x=>x.status===200)).toBe(true);expect(await models.Certificate.countDocuments({assignmentId:assignment._id})).toBe(1);expect((await models.Assignment.findById(assignment._id)).status).toBe('completed');expect(responses.some(x=>x.body.data.explanations?.length===1)).toBe(true);
  const cert=await models.Certificate.findOne({assignmentId:assignment._id});expect(cert.certificateNumber).toMatch(/^NEX-PHASETHR-\d{4}-\d{6}$/);expect(cert.expiryDate.getTime()).toBeGreaterThan(cert.issueDate.getTime());
  const verification=await request(app).get(`/api/v1/certificates/verify/${cert.certificateNumber}`);expect(verification.status).toBe(200);expect(Object.keys(verification.body.data).sort()).toEqual(['expiryDate','holderName','issueDate','title','valid']);
});

test('timed out attempts close cleanly, allow retry, and require trainer follow-up after max attempts',async()=>{
  const course=await models.Course.create({title:'Timed assessment',domainId:domain._id,trainerId:admin._id,status:'published',maxAttempts:2,modules:[{title:'Read',type:'note',notes:'Read'}]});const assignment=await models.Assignment.create({employeeId:employee._id,courseId:course._id,courseVersion:course.version});const assessment=await models.Assessment.create({courseId:course._id,timeLimitMinutes:1,questions:[{text:'Pick yes',type:'true_false',marks:1,options:[{text:'Yes',isCorrect:true},{text:'No',isCorrect:false}]}]});
  await request(app).post(`/api/v1/assignments/${assignment.id}/modules/${course.modules[0]._id}/complete`).set(auth(employeeToken));const first=await request(app).post(`/api/v1/assignments/${assignment.id}/attempts`).set(auth(employeeToken));expect(first.status).toBe(200);await models.Attempt.updateOne({_id:first.body.data.attempt._id},{$set:{startedAt:new Date(Date.now()-120000)}});
  const tooLate=await request(app).post(`/api/v1/attempts/${first.body.data.attempt._id}/submit`).set(auth(employeeToken)).send({answers:{}});expect(tooLate.status).toBe(422);expect((await models.Attempt.findById(first.body.data.attempt._id)).status).toBe('timed_out');
  const second=await request(app).post(`/api/v1/assignments/${assignment.id}/attempts`).set(auth(employeeToken));expect(second.status).toBe(200);const question=assessment.questions[0],wrong=question.options.find(option=>!option.isCorrect);const failed=await request(app).post(`/api/v1/attempts/${second.body.data.attempt._id}/submit`).set(auth(employeeToken)).send({answers:{[question._id]:String(wrong._id)}});expect(failed.status).toBe(200);expect(failed.body.data.attempt.passed).toBe(false);expect((await models.Assignment.findById(assignment._id)).followUpRequired).toBe(true);expect((await request(app).post(`/api/v1/assignments/${assignment.id}/attempts`).set(auth(employeeToken))).status).toBe(409);
});

test('assignment and compliance reads enforce employee ownership',async()=>{
  const course=await models.Course.create({title:'Private assigned course',domainId:domain._id,trainerId:admin._id,status:'published',isMandatory:true});const assignment=await models.Assignment.create({employeeId:employee._id,courseId:course._id,courseVersion:course.version});
  const list=await request(app).get('/api/v1/assignments/me').set(auth(employeeToken));expect(list.status).toBe(200);expect(list.body.data.map(x=>x._id)).toContain(String(assignment._id));
  const stranger=await models.User.create(userPayload('Other P3 Employee','p3-other@nexora.test'));const strangerToken=token(stranger);expect((await request(app).get(`/api/v1/assignments/${assignment.id}`).set(auth(strangerToken))).status).toBe(404);expect((await request(app).get(`/api/v1/users/${employee.id}/compliance`).set(auth(strangerToken))).status).toBe(404);
  const summary=await request(app).get(`/api/v1/users/${employee.id}/compliance`).set(auth(employeeToken));expect(summary.status).toBe(200);expect(summary.body.data.mandatoryCourses.some(item=>item.courseId===String(course._id))).toBe(true);
});

test('rule predicates support all fields, field-valid operators, and any matching',async()=>{
  const {matchesRule}=await import('../src/services/phase3Service.js');const candidate={domainId:domain._id,designation:'engineer',level:'mid',location:'Pune',tags:['security','api'],joinedOn:new Date(Date.now()-10*86400000)};
  for(const condition of [{field:'domainId',operator:'eq',value:String(domain._id)},{field:'designation',operator:'in',value:['engineer','manager']},{field:'level',operator:'not_in',value:['senior']},{field:'location',operator:'eq',value:'Pune'},{field:'tag',operator:'in',value:['api']},{field:'joinedWithinDays',operator:'gte',value:5},{field:'joinedWithinDays',operator:'lte',value:15}])expect(matchesRule(candidate,{matchType:'all',conditions:[condition]})).toBe(true);
  expect(matchesRule(candidate,{matchType:'all',conditions:[{field:'level',operator:'eq',value:'mid'},{field:'location',operator:'eq',value:'Delhi'}]})).toBe(false);expect(matchesRule(candidate,{matchType:'any',conditions:[{field:'level',operator:'eq',value:'senior'},{field:'location',operator:'eq',value:'Pune'}]})).toBe(true);
});

test('video progress clamps to duration, computes completion threshold, and rate limits rapid updates',async()=>{
  const course=await models.Course.create({title:'Video progress course',domainId:domain._id,trainerId:admin._id,status:'published',modules:[{title:'Video',type:'youtube',youtubeVideoId:'abcdefghijk',durationSeconds:50,completionThreshold:80,isRequired:true}]});const assignment=await models.Assignment.create({employeeId:employee._id,courseId:course._id,courseVersion:course.version});
  const url=`/api/v1/assignments/${assignment.id}/modules/${course.modules[0]._id}/progress`,data={watchedSeconds:100,lastPositionSeconds:100,durationSeconds:100};const saved=await request(app).put(url).set(auth(employeeToken)).send(data);expect(saved.status).toBe(200);expect(saved.body.data.progress.watchedSeconds).toBe(50);expect(saved.body.data.progress.completed).toBe(true);expect(saved.body.data.progressPercent).toBe(100);expect((await request(app).put(url).set(auth(employeeToken)).send(data)).status).toBe(429);
});

test('rule routes enforce admin writes and trainer reads stay within assigned domains',async()=>{
  const course=await models.Course.create({title:'Rule role course',domainId:domain._id,trainerId:admin._id,status:'published'});const trainer=await models.User.create(userPayload('Rule Reader','p3-rule-reader@nexora.test','trainer',{trainerDomains:[domain._id]})),trainerToken=token(trainer);
  expect((await request(app).post('/api/v1/rules').set(auth(trainerToken)).send({name:'Denied',courseId:String(course._id),conditions:[{field:'level',operator:'eq',value:'mid'}]})).status).toBe(403);
  const created=await request(app).post('/api/v1/rules').set(auth(adminToken)).send({name:'Toggle',courseId:String(course._id),conditions:[{field:'level',operator:'eq',value:'mid'}]});expect(created.status).toBe(200);
  const list=await request(app).get('/api/v1/rules').set(auth(trainerToken));expect(list.status).toBe(200);expect(list.body.data.some(x=>x._id===created.body.data._id)).toBe(true);
  const updated=await request(app).patch(`/api/v1/rules/${created.body.data._id}`).set(auth(adminToken)).send({isActive:false});expect(updated.status).toBe(200);expect(await models.Assignment.exists({employeeId:employee._id,courseId:course._id,status:'cancelled'})).toBeTruthy();
  expect((await request(app).delete(`/api/v1/rules/${created.body.data._id}`).set(auth(adminToken))).status).toBe(200);
});

test('rule re-evaluation cancels only not started rule assignments and retains completed records',async()=>{
  const courseA=await models.Course.create({title:'Rule cancel A',domainId:domain._id,trainerId:admin._id,status:'published'}),courseB=await models.Course.create({title:'Rule cancel B',domainId:domain._id,trainerId:admin._id,status:'published'});
  for(const course of [courseA,courseB]){const result=await request(app).post('/api/v1/rules').set(auth(adminToken)).send({name:`Rule ${course.title}`,courseId:String(course._id),conditions:[{field:'level',operator:'eq',value:'mid'}]});expect(result.status).toBe(200)}
  const a=await models.Assignment.findOne({employeeId:employee._id,courseId:courseA._id});expect(a.status).toBe('not_started');await models.Assignment.updateOne({_id:a._id},{$set:{status:'completed',completedAt:new Date()}});
  const changed=await request(app).patch(`/api/v1/users/${employee.id}`).set(auth(adminToken)).send({level:'senior'});expect(changed.status).toBe(200);
  expect((await models.Assignment.findById(a._id)).status).toBe('completed');expect((await models.Assignment.findOne({employeeId:employee._id,courseId:courseB._id})).status).toBe('cancelled');
});

test('employee creation assigns mandatory Common courses and evaluator creates expiry renewal assignments',async()=>{
  const common=await models.Domain.create({name:'Common Courses',isCommon:true});const commonCourse=await models.Course.create({title:'Common onboarding',domainId:common._id,trainerId:admin._id,status:'published',isMandatory:true});
  const created=await request(app).post('/api/v1/users').set(auth(adminToken)).send({name:'Common New Employee',email:'p3-common@nexora.test',password:'P3-User-Strong-Password!44',domainId:String(domain._id)});expect(created.status).toBe(200);const newUser=await models.User.findOne({email:'p3-common@nexora.test'});expect(await models.Assignment.exists({employeeId:newUser._id,courseId:commonCourse._id,source:'onboarding'})).toBeTruthy();
  const expiring=await models.Course.create({title:'Renewal course',domainId:domain._id,trainerId:admin._id,status:'published',validityMonths:12});const certificate=await models.Certificate.create({employeeId:employee._id,courseId:expiring._id,title:expiring.title,issueDate:new Date(),expiryDate:new Date(Date.now()+20*86400000),certificateNumber:'NEX-PHASETHR-2026-999999',status:'valid',source:'internal'});await models.Settings.create({key:'certificateRenewalDays',value:30});const {evaluateRulesForEmployee}=await import('../src/services/phase3Service.js');await evaluateRulesForEmployee(employee);expect(await models.Assignment.exists({employeeId:employee._id,courseId:expiring._id,source:'expiry_renewal',cycle:`renewal:${certificate._id}`})).toBeTruthy();
});

test('assignment administration supports pagination, manual bulk assignment, due dates, and cancellation audit',async()=>{
  const course=await models.Course.create({title:'Admin assignments course',domainId:domain._id,trainerId:admin._id,status:'published'});const other=await models.User.create(userPayload('Second P3 Employee','p3-second@nexora.test','employee',{domainId:domain._id,level:'junior'}));
  const bulk=await request(app).post('/api/v1/assignments').set(auth(adminToken)).send({courseId:String(course._id),employeeIds:[String(employee._id),String(other._id)],dueDate:new Date(Date.now()+86400000).toISOString()});expect(bulk.status).toBe(200);expect(bulk.body.data.createdCount).toBe(2);
  const list=await request(app).get(`/api/v1/assignments?courseId=${course.id}&page=1&limit=1`).set(auth(adminToken));expect(list.status).toBe(200);expect(list.body.meta.total).toBe(2);expect(list.body.data).toHaveLength(1);
  const assignment=bulk.body.data.created[0],due=await request(app).patch(`/api/v1/assignments/${assignment._id}`).set(auth(adminToken)).send({dueDate:new Date(Date.now()+2*86400000).toISOString()});expect(due.status).toBe(200);
  const cancelled=await request(app).patch(`/api/v1/assignments/${assignment._id}`).set(auth(adminToken)).send({cancel:true});expect(cancelled.body.data.status).toBe('cancelled');expect(await models.AuditLog.exists({entityId:assignment._id,action:'assignment.update'})).toBeTruthy();
  expect((await request(app).post('/api/v1/assignments').set(auth(adminToken)).send({courseId:String(course._id),employeeIds:[String(employee._id)],filter:{level:'mid'}})).status).toBe(400);
});

test('external certificates use private files, domain verification, reportee scope, and revocation',async()=>{
  const course=await models.Course.create({title:'External cert course',domainId:domain._id,trainerId:admin._id,status:'published'});const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const uploaded=await request(app).post('/api/v1/certificates').set(auth(employeeToken)).field('courseId',String(course._id)).field('expiryDate',new Date(Date.now()+14*86400000).toISOString()).attach('file',pdf,'external.pdf',{contentType:'application/pdf'});expect(uploaded.status).toBe(200);expect(uploaded.body.data.status).toBe('pending_verification');const certId=uploaded.body.data._id;
  const me=await request(app).get('/api/v1/certificates/me').set(auth(employeeToken));expect(me.status).toBe(200);expect(me.body.data.map(x=>x._id)).toContain(certId);
  const trainer=await models.User.create(userPayload('P3 Trainer','p3-trainer@nexora.test','trainer',{trainerDomains:[domain._id]})),trainerToken=token(trainer);const verified=await request(app).patch(`/api/v1/certificates/${certId}/verify`).set(auth(trainerToken));expect(verified.status).toBe(200);expect(verified.body.data.verifiedBy).toBe(String(trainer._id));
  const expiring=await request(app).get('/api/v1/certificates/expiring?days=20').set(auth(adminToken));expect(expiring.status).toBe(200);expect(expiring.body.data.some(x=>x._id===certId)).toBe(true);
  const manager=await models.User.create(userPayload('P3 Manager','p3-manager@nexora.test','employee'));await models.User.updateOne({_id:employee._id},{$set:{managerId:manager._id}});const managerToken=token(manager);const managerList=await request(app).get(`/api/v1/certificates?employeeId=${employee.id}`).set(auth(managerToken));expect(managerList.status).toBe(200);expect(managerList.body.data.map(x=>x._id)).toContain(certId);
  const {localUploadStorage}=await import('../src/services/uploadStorage.js');const storageName='phase3-cert-test.pdf';await localUploadStorage.put(storageName,pdf);const fileRecord=await models.Upload.create({storageName,originalName:'report.pdf',mimeType:'application/pdf',size:pdf.length,uploadedBy:employee._id});await models.Certificate.updateOne({_id:certId},{$set:{uploadId:fileRecord._id}});
  expect((await request(app).get(`/api/v1/certificates/${certId}/file`).set(auth(employeeToken))).status).toBe(200);const stranger=await models.User.create(userPayload('P3 Stranger','p3-file-stranger@nexora.test'));expect((await request(app).get(`/api/v1/certificates/${certId}/file`).set(auth(token(stranger)))).status).toBe(404);expect((await request(app).get(`/api/v1/certificates/${certId}/file`).set(auth(managerToken))).status).toBe(200);
  const selfCert=await models.Certificate.create({employeeId:admin._id,courseId:course._id,title:'Admin personal',issueDate:new Date(),status:'pending_verification',source:'external'});expect((await request(app).patch(`/api/v1/certificates/${selfCert.id}/verify`).set(auth(adminToken))).status).toBe(403);
  const revoked=await request(app).patch(`/api/v1/certificates/${certId}/revoke`).set(auth(adminToken)).send({reason:'Duplicate document'});expect(revoked.status).toBe(200);expect((await request(app).get('/api/v1/certificates/verify/NEX-UNKNOWN-2026-000001')).status).toBe(404);
  const repairCourse=await models.Course.create({title:'Repair certificate course',domainId:domain._id,trainerId:admin._id,status:'published'}),finished=await models.Assignment.create({employeeId:employee._id,courseId:repairCourse._id,courseVersion:repairCourse.version,status:'completed',completedAt:new Date()});const repaired=await request(app).post('/api/v1/admin/repair/certificates').set(auth(adminToken));expect(repaired.status).toBe(200);expect(await models.Certificate.exists({assignmentId:finished._id})).toBeTruthy();
  await localUploadStorage.delete(storageName);await models.Upload.deleteOne({_id:fileRecord._id});
});
