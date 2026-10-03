import {jest,test,expect,beforeAll,afterAll,beforeEach} from '@jest/globals';
import request from 'supertest';
import {MongoMemoryServer} from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {rm} from 'node:fs/promises';

let mongod,app,models,env,admin,trainer,employee,adminToken,trainerToken,employeeToken,domain,foreign;
const uploadDir=`./.test-uploads-${process.pid}`;
const password='Long-enough-Password-837!';
const user=(name,email,role='employee',extra={})=>({name,email,passwordHash:bcrypt.hashSync(password,4),role,status:'active',...extra});
const issue=u=>jwt.sign({userId:String(u._id),role:u.role,tokenVersion:0},env.JWT_SECRET,{algorithm:'HS256',expiresIn:'15m',issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE});
const auth=t=>({Authorization:`Bearer ${t}`});
const coursePayload=(d,title='Phase 2 course')=>({title,description:'Details',domainId:String(d._id),eligibility:{levels:['mid']},isMandatory:true});
const q={questions:[{text:'Question?',options:[{text:'Right',isCorrect:true},{text:'Wrong',isCorrect:false}],marks:2}],timeLimitMinutes:10};

beforeAll(async()=>{
  process.env.NODE_ENV='test';process.env.MONGODB_URI='mongodb://localhost/ignored';process.env.JWT_SECRET='phase-two-test-secret-longer-than-32-chars';process.env.CORS_ORIGINS='http://localhost:5173';process.env.UPLOAD_DIR=uploadDir;
  mongod=await MongoMemoryServer.create();process.env.MONGODB_URI=mongod.getUri();
  ({app}=await import('../src/app.js'));models=await import('../src/models/index.js');env=(await import('../src/config/env.js')).env;await mongoose.connect(mongod.getUri());
  admin=await models.User.create(user('Admin','phase2-admin@test.dev','admin'));trainer=await models.User.create(user('Trainer','phase2-trainer@test.dev','trainer'));employee=await models.User.create(user('Employee','phase2-employee@test.dev'));
  domain=await models.Domain.create({name:'Phase2 own'});foreign=await models.Domain.create({name:'Phase2 foreign'});trainer.trainerDomains=[domain._id];await trainer.save();adminToken=issue(admin);trainerToken=issue(trainer);employeeToken=issue(employee);
},60000);
afterAll(async()=>{await mongoose.disconnect();await mongod?.stop();await rm(uploadDir,{recursive:true,force:true});});
beforeEach(async()=>{for(const M of [models.Assignment,models.Assessment,models.Course,models.Upload,models.AuditLog])await M.deleteMany({});});

test('trainer course CRUD is confined to assigned domain and creates a draft',async()=>{
  const made=await request(app).post('/api/v1/courses').set(auth(trainerToken)).send(coursePayload(domain));expect(made.status).toBe(200);expect(made.body.data.status).toBe('draft');
  expect((await request(app).get(`/api/v1/courses/${made.body.data._id}`).set(auth(trainerToken))).status).toBe(200);
  expect((await request(app).patch(`/api/v1/courses/${made.body.data._id}`).set(auth(trainerToken)).send({title:'Updated title'})).status).toBe(200);
  const outsider=await models.Course.create({title:'Foreign',domainId:foreign._id,trainerId:admin._id,status:'draft'});
  expect((await request(app).get(`/api/v1/courses/${outsider.id}`).set(auth(trainerToken))).status).toBe(404);
  expect((await request(app).patch(`/api/v1/courses/${outsider.id}`).set(auth(trainerToken)).send({title:'attack'})).status).toBe(404);
  expect((await request(app).post('/api/v1/courses').set(auth(trainerToken)).send(coursePayload(foreign))).status).toBe(403);
  expect((await request(app).patch(`/api/v1/courses/${made.body.data._id}`).set(auth(trainerToken)).send({status:'published'})).status).toBe(400);
  const listed=await request(app).get('/api/v1/courses?search=Updated&sort=title&order=asc').set(auth(trainerToken));expect(listed.status).toBe(200);expect(listed.body.data).toHaveLength(1);
  expect((await request(app).get('/api/v1/courses?limit=101').set(auth(adminToken))).status).toBe(400);
});

test('course transition guards reject invalid transitions and audit review changes',async()=>{
  const c=await models.Course.create({title:'Review',domainId:domain._id,trainerId:trainer._id,status:'draft',eligibility:{role:'employee'}});
  expect((await request(app).post(`/api/v1/courses/${c.id}/approve`).set(auth(adminToken))).status).toBe(422);
  await models.Course.updateOne({_id:c._id},{$set:{status:'under_review'}});
  const self=await models.User.create(user('Admin Trainer','same-owner@test.dev','admin'));await models.Course.updateOne({_id:c._id},{$set:{trainerId:self._id}});
  expect((await request(app).post(`/api/v1/courses/${c.id}/approve`).set(auth(issue(self)))).status).toBe(403);
  await models.Course.updateOne({_id:c._id},{$set:{trainerId:trainer._id}});
  expect((await request(app).post(`/api/v1/courses/${c.id}/reject`).set(auth(adminToken)).send({notes:''})).status).toBe(400);
  const rejected=await request(app).post(`/api/v1/courses/${c.id}/reject`).set(auth(adminToken)).send({notes:'Incomplete'});expect(rejected.status).toBe(200);expect(rejected.body.data.status).toBe('rejected');
  expect(await models.AuditLog.exists({entityId:c._id,action:'course.reject'})).toBeTruthy();
  const submitted=await request(app).post(`/api/v1/courses/${c.id}/submit`).set(auth(trainerToken));expect(submitted.status).toBe(422);
});

test('modules sanitize notes, reorder exact IDs, and assessments validate safely',async()=>{
  const c=await models.Course.create({title:'Modules',domainId:domain._id,trainerId:trainer._id,status:'draft',eligibility:{role:'employee'}}),url=`/api/v1/courses/${c.id}`;
  const note=await request(app).post(`${url}/modules`).set(auth(trainerToken)).send({title:'Note',type:'note',notes:'<p>ok</p><script>bad()</script>'});expect(note.status).toBe(200);expect(note.body.data.notes).not.toContain('script');
  const video=await request(app).post(`${url}/modules`).set(auth(trainerToken)).send({title:'Video',type:'youtube',youtubeVideoId:'abcdefghijk'});expect(video.status).toBe(200);
  const ids=[note.body.data._id,video.body.data._id];expect((await request(app).patch(`${url}/modules/reorder`).set(auth(trainerToken)).send({order:[ids[1]]})).status).toBe(422);
  expect((await request(app).patch(`${url}/modules/reorder`).set(auth(trainerToken)).send({order:[ids[1],ids[0]]})).status).toBe(200);
  expect((await request(app).patch(`${url}/modules/${ids[0]}`).set(auth(trainerToken)).send({title:'Renamed'})).status).toBe(200);
  expect((await request(app).delete(`${url}/modules/${ids[1]}`).set(auth(trainerToken))).status).toBe(200);
  expect((await request(app).put(`${url}/assessment`).set(auth(trainerToken)).send({questions:[{text:'Bad?',options:[{text:'No',isCorrect:false},{text:'No2',isCorrect:false}],marks:2}]})).status).toBe(400);
  expect((await request(app).put(`${url}/assessment`).set(auth(trainerToken)).send(q)).status).toBe(200);
  expect((await request(app).get(`${url}/assessment`).set(auth(trainerToken))).status).toBe(200);
  expect((await request(app).get(`${url}/assessment`).set(auth(employeeToken))).status).toBe(403);
});

test('employees see only published courses assigned to them',async()=>{
  const published=await models.Course.create({title:'Employee course',domainId:domain._id,trainerId:trainer._id,status:'published'});
  const draft=await models.Course.create({title:'Hidden draft',domainId:domain._id,trainerId:trainer._id,status:'draft'});
  await models.Assignment.create({employeeId:employee._id,courseId:published._id,courseVersion:published.version});
  const list=await request(app).get('/api/v1/courses').set(auth(employeeToken));expect(list.status).toBe(200);expect(list.body.data.map(x=>String(x._id))).toEqual([String(published._id)]);
  expect((await request(app).get(`/api/v1/courses/${published.id}`).set(auth(employeeToken))).status).toBe(200);
  expect((await request(app).get(`/api/v1/courses/${draft.id}`).set(auth(employeeToken))).status).toBe(404);
});

test('submit approve archive state machine and idempotent version cloning preserve old assignments',async()=>{
  const c=await models.Course.create({title:'Versioned',domainId:domain._id,trainerId:trainer._id,status:'draft',eligibility:{level:'mid'},modules:[{title:'Video',type:'youtube',youtubeVideoId:'abcdefghijk'}]});
  await models.Assessment.create({courseId:c._id,questions:q.questions});
  expect((await request(app).post(`/api/v1/courses/${c.id}/submit`).set(auth(trainerToken))).status).toBe(200);
  expect((await request(app).post(`/api/v1/courses/${c.id}/approve`).set(auth(adminToken))).status).toBe(200);
  const assignment=await models.Assignment.create({employeeId:employee._id,courseId:c._id,courseVersion:1});
  expect((await request(app).patch(`/api/v1/courses/${c.id}`).set(auth(adminToken)).send({title:'Edited'})).status).toBe(422);
  const v1=await request(app).post(`/api/v1/courses/${c.id}/new-version`).set(auth(trainerToken));const v2=await request(app).post(`/api/v1/courses/${c.id}/new-version`).set(auth(trainerToken));
  expect(v1.status).toBe(200);expect(v1.body.data._id).toBe(v2.body.data._id);expect(v1.body.data.version).toBe(2);expect(v1.body.data.status).toBe('draft');expect(String((await models.Assignment.findById(assignment.id)).courseId)).toBe(String(c._id));expect(await models.Assessment.exists({courseId:v1.body.data._id})).toBeTruthy();
  expect((await request(app).get(`/api/v1/courses/${c.id}/assessment`).set(auth(employeeToken))).status).toBe(403);
  expect((await request(app).post(`/api/v1/courses/${c.id}/archive`).set(auth(adminToken))).status).toBe(200);expect(await models.AuditLog.exists({entityId:c._id,action:'course.archive'})).toBeTruthy();
});

test('draft deletion is guarded by assignment references and audited',async()=>{
  const c=await models.Course.create({title:'Delete',domainId:domain._id,trainerId:trainer._id,status:'draft'});
  await models.Assignment.create({employeeId:employee._id,courseId:c._id,courseVersion:1});expect((await request(app).delete(`/api/v1/courses/${c.id}`).set(auth(adminToken))).status).toBe(409);
  await models.Assignment.deleteMany({courseId:c._id});expect((await request(app).delete(`/api/v1/courses/${c.id}`).set(auth(adminToken))).status).toBe(200);expect(await models.AuditLog.exists({entityId:c._id,action:'course.delete'})).toBeTruthy();
});

test('YouTube URL validation blocks malicious origins and IDs',async()=>{
  const valid=['https://youtube.com/watch?v=abcdefghijk','https://youtu.be/abcdefghijk','https://www.youtube.com/embed/abcdefghijk','https://m.youtube.com/shorts/abcdefghijk'];
  for(const url of valid)expect((await request(app).post('/api/v1/modules/validate-youtube').set(auth(trainerToken)).send({url,title:'Manual'})).status).toBe(200);
  const invalid=['javascript:alert(1)','https://youtube.com.evil.com/watch?v=abcdefghijk','https://evil.test/abcdefghijk','http://youtube.com/watch?v=abcdefghijk','https://youtube.com/watch?v=abcdefghij','https://youtube.com/watch?v=abcdefghijkl'];
  for(const url of invalid)expect((await request(app).post('/api/v1/modules/validate-youtube').set(auth(trainerToken)).send({url})).status).toBe(400);
});

test('YouTube Data API uses only the fixed endpoint and caches validated video metadata',async()=>{
  const {validateYouTube,clearYouTubeCache}=await import('../src/services/youtubeMetadataService.js');
  const previousKey=env.YOUTUBE_API_KEY,previousFetch=global.fetch;env.YOUTUBE_API_KEY='test-api-key';
  global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({items:[{snippet:{title:'Metadata title'},contentDetails:{duration:'PT1H2M3S'},status:{embeddable:true}}]})});
  try{
    clearYouTubeCache();const first=await validateYouTube({url:'https://youtu.be/abcdefghijk'});const second=await validateYouTube({url:'https://youtube.com/watch?v=abcdefghijk'});
    expect(first.title).toBe('Metadata title');expect(first.durationSeconds).toBe(3723);expect(first.embeddable).toBe(true);expect(second.title).toBe(first.title);expect(global.fetch).toHaveBeenCalledTimes(1);
    const target=new URL(global.fetch.mock.calls[0][0]);expect(target.origin+target.pathname).toBe('https://www.googleapis.com/youtube/v3/videos');
    global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({items:[]})});clearYouTubeCache();await expect(validateYouTube({url:'https://youtu.be/zzzzzzzzzzz'})).rejects.toMatchObject({code:'INVALID_VIDEO'});
    global.fetch=jest.fn().mockResolvedValue({ok:false});await expect(validateYouTube({url:'https://youtu.be/yyyyyyyyyyy'})).rejects.toMatchObject({statusCode:502});
  }finally{global.fetch=previousFetch;if(previousKey===undefined)delete env.YOUTUBE_API_KEY;else env.YOUTUBE_API_KEY=previousKey;clearYouTubeCache();}
});

test('private uploads require matching extension, MIME and magic bytes, and employee course assignment',async()=>{
  const c=await models.Course.create({title:'Upload',domainId:domain._id,trainerId:trainer._id,status:'draft'}),url=`/api/v1/courses/${c.id}/uploads`;
  expect((await request(app).post(url).set(auth(trainerToken)).attach('file',Buffer.from('no'),'bad.txt',{contentType:'text/plain'})).status).toBe(400);
  expect((await request(app).post(url).set(auth(trainerToken)).attach('file',Buffer.from('not a pdf'),'bad.pdf',{contentType:'application/pdf'})).status).toBe(400);
  const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');const saved=await request(app).post(url).set(auth(trainerToken)).attach('file',pdf,'safe.pdf',{contentType:'application/pdf'});expect(saved.status).toBe(200);
  const png=Buffer.from('89504e470d0a1a0a0000000d4948445200000001','hex');expect((await request(app).post(url).set(auth(trainerToken)).attach('file',png,'image.png',{contentType:'image/png'})).status).toBe(200);
  const upload=saved.body.data.id;expect((await request(app).post(`/api/v1/courses/${c.id}/modules`).set(auth(trainerToken)).send({title:'Document',type:'pdf',uploadId:upload})).status).toBe(200);
  expect((await request(app).get(`/api/v1/uploads/${upload}`).set(auth(employeeToken))).status).toBe(404);
  await models.Course.updateOne({_id:c._id},{$set:{status:'published'}});await models.Assignment.create({employeeId:employee._id,courseId:c._id,courseVersion:1});
  expect((await request(app).get(`/api/v1/uploads/${upload}`).set(auth(employeeToken))).status).toBe(200);
  const {saveUpload}=await import('../src/services/uploadStorage.js');await expect(saveUpload({size:5*1024*1024+1,buffer:Buffer.alloc(1),originalname:'big.pdf',mimetype:'application/pdf'},trainer,c._id)).rejects.toMatchObject({statusCode:400});
});
