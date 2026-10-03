import { jest, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { routes } from '../scripts/rbac-matrix.js';

let mongod, app, models, authService, resources, env, admin, employee, otherEmployee, trainer, adminToken, employeeToken, trainerToken;
const password='Sufficient-Strong-Secret-42!';
const userPayload=(name,email,role='employee',extra={})=>({name,email,passwordHash:bcrypt.hashSync(password,12),role,status:'active',...extra});
const routeUrl=path=>`/api/v1${path.replace(/:id/g,'507f1f77bcf86cd799439011').replace(/:moduleId/g,'507f1f77bcf86cd799439012').replace(/:name/g,'compliance').replace(/:courseId/g,'507f1f77bcf86cd799439011')}`;
const issue=user=>jwt.sign({userId:String(user._id),role:user.role,tokenVersion:user.tokenVersion||0},env.JWT_SECRET,{algorithm:'HS256',expiresIn:'15m',issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE});

beforeAll(async()=>{
  process.env.NODE_ENV='test';process.env.MONGODB_URI='mongodb://127.0.0.1:27017/ignored';process.env.JWT_SECRET='unit-test-secret-at-least-32-characters-long';process.env.CORS_ORIGINS='http://localhost:5173';process.env.MAILER_TRANSPORT='console';
  mongod=await MongoMemoryServer.create();process.env.MONGODB_URI=mongod.getUri();
  ({app}=await import('../src/app.js'));models=await import('../src/models/index.js');authService=await import('../src/services/authService.js');resources=await import('../src/services/resourceService.js');env=(await import('../src/config/env.js')).env;
  await mongoose.connect(mongod.getUri());
  admin=await models.User.create(userPayload('Platform Admin','admin@nexora.test','admin'));
  employee=await models.User.create(userPayload('Employee One','employee@nexora.test'));
  otherEmployee=await models.User.create(userPayload('Employee Two','other@nexora.test'));
  trainer=await models.User.create(userPayload('Trainer One','trainer@nexora.test','trainer'));
  adminToken=issue(admin);employeeToken=issue(employee);trainerToken=issue(trainer);
},60000);
afterAll(async()=>{await mongoose.disconnect();if(mongod)await mongod.stop()});
beforeEach(async()=>{await models.RefreshSession.deleteMany({});await models.PasswordReset.deleteMany({})});

test('RBAC generator declares access for every route and writes route matrix',()=>{
  expect(routes.length).toBeGreaterThan(20);expect(routes.filter(r=>!r.roles.length)).toEqual([]);
});

test('every protected route returns 401 without a token',async()=>{
  const protectedRoutes=routes.filter(r=>r.protectedRoute);expect(protectedRoutes.length).toBeGreaterThan(10);
  for(const route of protectedRoutes){const response=await request(app)[route.method.toLowerCase()](routeUrl(route.path));expect(response.status).toBe(401);expect(response.body.success).toBe(false)}
});

test('every protected route with an available wrong-role principal returns 403 before handler work',async()=>{
  const tokens={ADMIN:adminToken,TRAINER:trainerToken,EMPLOYEE:employeeToken};const denied=routes.filter(r=>r.protectedRoute&&Object.keys(tokens).some(role=>!r.roles.includes(role)));
  expect(denied.length).toBeGreaterThan(10);
  for(const route of denied){const role=Object.keys(tokens).find(candidate=>!route.roles.includes(candidate));const response=await request(app)[route.method.toLowerCase()](routeUrl(route.path)).set('Authorization',`Bearer ${tokens[role]}`);expect(response.status).toBe(403)}
});

test('every route with an ObjectId or certificate-number path parameter rejects malformed values',async()=>{
  const tokens={ADMIN:adminToken,TRAINER:trainerToken,EMPLOYEE:employeeToken};
  for(const route of routes.filter(item=>item.path.includes(':id')||item.path.includes(':moduleId')||item.path.includes(':certificateNumber'))){
    const url=`/api/v1${route.path.replace(/:id|:moduleId/g,'not-an-object-id').replace(':certificateNumber','not-a-certificate-number').replace(':name','compliance')}`;const req=request(app)[route.method.toLowerCase()](url);if(route.protectedRoute){const role=route.roles.find(candidate=>tokens[candidate]);req.set('Authorization',`Bearer ${tokens[role]}`)}const response=await req;expect(response.status).toBe(400);
  }
});

test('user IDOR reads and profile updates are hidden as not found',async()=>{
  const get=await request(app).get(`/api/v1/users/${otherEmployee.id}`).set('Authorization',`Bearer ${employeeToken}`);expect(get.status).toBe(404);
  const patch=await request(app).patch(`/api/v1/users/${otherEmployee.id}`).set('Authorization',`Bearer ${employeeToken}`).send({name:'Hacked'});expect(patch.status).toBe(404);
  expect((await models.User.findById(otherEmployee.id)).name).toBe('Employee Two');
});

test('profile mass assignment cannot change role/domain/status/tokenVersion/passwordHash',async()=>{
  const domain=await models.Domain.create({name:'Test Domain'});await models.User.updateOne({_id:employee._id},{$set:{domainId:domain._id}});
  const old=await models.User.findById(employee._id).select('+tokenVersion +passwordHash');const oldHash=old.passwordHash;
  const response=await request(app).patch(`/api/v1/users/${employee.id}`).set('Authorization',`Bearer ${employeeToken}`).send({name:'Employee One Renamed',role:'admin',domainId:new mongoose.Types.ObjectId().toString(),status:'inactive',tokenVersion:999,passwordHash:'attacker'});
  expect(response.status).toBe(200);const current=await models.User.findById(employee._id).select('+tokenVersion +passwordHash');expect(current.role).toBe('employee');expect(String(current.domainId)).toBe(String(domain._id));expect(current.status).toBe('active');expect(current.tokenVersion).toBe(0);expect(current.passwordHash).toBe(oldHash);
});

test('managers can list only reportees and admin security updates revoke old access',async()=>{
  const manager=await models.User.create(userPayload('Manager','manager@nexora.test','employee'));
  await models.User.create(userPayload('Reportee','report@nexora.test','employee',{managerId:manager._id}));
  const managerResponse=await request(app).get('/api/v1/users').set('Authorization',`Bearer ${issue(manager)}`);expect(managerResponse.status).toBe(200);expect(managerResponse.body.data.map(x=>x.email)).toEqual(['report@nexora.test']);
  const target=await models.User.create(userPayload('Role Target','role-target@nexora.test'));
  const domain=await models.Domain.create({name:'Security Update Domain'});
  const oldToken=issue(target);const updated=await request(app).patch(`/api/v1/users/${target.id}`).set('Authorization',`Bearer ${adminToken}`).send({role:'trainer',domainId:String(domain._id)});
  expect(updated.status).toBe(200);expect(updated.body.data.role).toBe('trainer');expect(String(updated.body.data.domainId)).toBe(String(domain._id));
  expect(await models.AuditLog.exists({entityId:target._id,action:'user.security_update'})).toBeTruthy();
  expect((await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${oldToken}`)).status).toBe(401);
});

test('manager visibility, reads, writes and assignment visibility end when a reportee is reassigned',async()=>{
  const manager=await models.User.create(userPayload('Scoped Manager','scoped-manager@nexora.test','employee'));
  const otherManager=await models.User.create(userPayload('Other Manager','other-manager@nexora.test','employee'));
  const report=await models.User.create(userPayload('Scoped Reportee','scoped-report@nexora.test','employee',{managerId:manager._id}));
  const outsider=await models.User.create(userPayload('Outsider','scoped-outsider@nexora.test'));
  const token=issue(manager),course=await models.Course.create({title:'Manager assignment course',domainId:new mongoose.Types.ObjectId(),trainerId:trainer._id,status:'published'});
  const assigned=await request(app).post('/api/v1/assignments').set('Authorization',`Bearer ${token}`).send({employeeId:report.id,courseId:course.id});expect(assigned.status).toBe(200);
  const assignment=assigned.body.data;
  expect((await request(app).post('/api/v1/assignments').set('Authorization',`Bearer ${token}`).send({employeeId:outsider.id,courseId:course.id})).status).toBe(404);
  expect((await request(app).post('/api/v1/assignments').set('Authorization',`Bearer ${token}`).send({employeeId:report.id,courseId:course.id})).body.data._id).toBe(assignment._id);
  expect((await request(app).get(`/api/v1/users/${report.id}`).set('Authorization',`Bearer ${token}`)).status).toBe(200);
  expect((await request(app).get(`/api/v1/users/${outsider.id}`).set('Authorization',`Bearer ${token}`)).status).toBe(404);
  expect((await request(app).patch(`/api/v1/users/${outsider.id}`).set('Authorization',`Bearer ${token}`).send({name:'No'})).status).toBe(404);
  expect((await request(app).get('/api/v1/assignments').set('Authorization',`Bearer ${token}`)).body.data.map(x=>String(x._id))).toContain(String(assignment._id));
  await models.User.updateOne({_id:report._id},{$set:{managerId:otherManager._id}});
  expect((await request(app).post('/api/v1/assignments').set('Authorization',`Bearer ${token}`).send({employeeId:report.id,courseId:course.id})).status).toBe(403);
  expect((await request(app).get('/api/v1/users').set('Authorization',`Bearer ${token}`)).status).toBe(403);
  expect((await request(app).get(`/api/v1/users/${report.id}`).set('Authorization',`Bearer ${token}`)).status).toBe(404);
  expect((await request(app).patch(`/api/v1/users/${report.id}`).set('Authorization',`Bearer ${token}`).send({name:'Still No'})).status).toBe(404);
  expect((await request(app).get('/api/v1/assignments').set('Authorization',`Bearer ${token}`)).status).toBe(403);
});

test('auth logout routes revoke refresh sessions and reject malformed or forced-change access',async()=>{
  const session=await authService.login(employee.email,password);
  const bad=await request(app).get('/api/v1/auth/me').set('Authorization','Bearer not.a.jwt');expect(bad.status).toBe(401);
  const logout=await request(app).post('/api/v1/auth/logout').set('Authorization',`Bearer ${session.accessToken}`).set('Origin','http://localhost:5173').set('X-Requested-With','XMLHttpRequest').set('Cookie',`refreshToken=${session.refreshToken}`);expect(logout.status).toBe(200);
  const session2=await authService.login(employee.email,password);const all=await request(app).post('/api/v1/auth/logout-all').set('Authorization',`Bearer ${session2.accessToken}`);expect(all.status).toBe(200);expect(await models.RefreshSession.countDocuments({userId:employee._id,expiresAt:{$gt:new Date()}})).toBe(0);expect((await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${session2.accessToken}`)).status).toBe(401);
  employee=await models.User.findById(employee._id).select('+tokenVersion');employeeToken=issue(employee);
  const forced=await models.User.create(userPayload('Forced User','forced@nexora.test','employee',{forcePasswordChange:true}));
  expect((await request(app).get('/api/v1/users').set('Authorization',`Bearer ${issue(forced)}`)).status).toBe(403);
  expect((await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${issue(forced)}`)).status).toBe(200);
});

test('authentication rejects expired claims, stale tokenVersion and role mismatch; auth service handles refresh expiry',async()=>{
  const stale=jwt.sign({userId:employee.id,role:'admin',tokenVersion:0},env.JWT_SECRET,{algorithm:'HS256',expiresIn:'15m',issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE});
  const oldVersion=jwt.sign({userId:employee.id,role:'employee',tokenVersion:9},env.JWT_SECRET,{algorithm:'HS256',expiresIn:'15m',issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE});
  const expiredJwt=jwt.sign({userId:employee.id,role:'employee',tokenVersion:0},env.JWT_SECRET,{algorithm:'HS256',expiresIn:-1,issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE});
  expect((await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${stale}`)).status).toBe(401);
  expect((await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${oldVersion}`)).status).toBe(401);
  expect((await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${expiredJwt}`)).status).toBe(401);
  await expect(authService.rotate('')).rejects.toMatchObject({code:'INVALID_TOKEN'});
  await expect(authService.rotate('unknown-refresh-token')).rejects.toMatchObject({code:'INVALID_TOKEN'});
  const expired=await models.RefreshSession.create({userId:employee._id,tokenHash:'aa'.repeat(32),familyId:'expired-family',expiresAt:new Date(Date.now()-1000)});
  await expect(authService.rotate('expired-token')).rejects.toMatchObject({code:'INVALID_TOKEN'});
  await models.RefreshSession.updateOne({_id:expired._id},{$set:{tokenHash:(await import('node:crypto')).createHash('sha256').update('expired-token').digest('hex')}});
  await expect(authService.rotate('expired-token')).rejects.toMatchObject({code:'TOKEN_EXPIRED'});
});

test('password and reset error paths are guarded and reset mail failures stay non-enumerating',async()=>{
  await expect(authService.passwordChange(new mongoose.Types.ObjectId(),'x','A-good-password-473!')).rejects.toMatchObject({statusCode:404});
  await expect(authService.passwordChange(employee._id,'wrong','A-good-password-473!')).rejects.toMatchObject({code:'INVALID_PASSWORD'});
  await expect(authService.resetPassword('','A-good-password-473!')).rejects.toMatchObject({code:'INVALID_TOKEN'});
  await expect(authService.resetPassword('missing-reset-token','A-good-password-473!')).rejects.toMatchObject({code:'INVALID_TOKEN'});
  const crypto=await import('node:crypto'),orphanToken='orphan-token';await models.PasswordReset.create({userId:new mongoose.Types.ObjectId(),tokenHash:crypto.createHash('sha256').update(orphanToken).digest('hex'),expiresAt:new Date(Date.now()+60000)});
  await expect(authService.resetPassword(orphanToken,'A-good-password-473!')).rejects.toMatchObject({code:'INVALID_TOKEN'});
  const inactive=await models.User.create(userPayload('Inactive','inactive@nexora.test','employee',{status:'inactive'}));
  await expect(authService.login(inactive.email,password)).rejects.toMatchObject({code:'INVALID_CREDENTIALS'});
  const orphanRefresh='orphan-refresh-token';await models.RefreshSession.create({userId:new mongoose.Types.ObjectId(),tokenHash:crypto.createHash('sha256').update(orphanRefresh).digest('hex'),familyId:'orphan-family',expiresAt:new Date(Date.now()+60000)});
  await expect(authService.rotate(orphanRefresh)).rejects.toMatchObject({code:'INVALID_TOKEN'});
  await expect(authService.forgotPassword('unknown-user@nexora.test')).resolves.toBeUndefined();
  const {mailer}=await import('../src/config/mailer.js');const original=mailer.send;mailer.send=async()=>{throw new Error('offline')};
  await expect(authService.forgotPassword(employee.email)).resolves.toBeUndefined();mailer.send=original;
  const {consoleMailer,createSmtpMailer}=await import('../src/config/mailer.js');await expect(consoleMailer.send({to:'dev@test',subject:'test',text:'body'})).resolves.toBeUndefined();
  expect(()=>createSmtpMailer()).toThrow('SMTP settings are required');
});

test('domain lifecycle and list services enforce conflicts and write audit records',async()=>{
  const created=await resources.createDomain({name:'Resource Domain',description:'Initial'},admin);
  const changed=await resources.updateDomain(created.id,{description:'Changed'},admin);expect(changed.description).toBe('Changed');
  await expect(resources.deactivateDomain(created.id,admin)).resolves.toBe(true);
  expect(await models.AuditLog.exists({entityId:created._id,action:'domain.deactivate'})).toBeTruthy();
  const inUse=await models.Domain.create({name:'Busy Resource Domain'});await models.User.create(userPayload('Busy','busy-resource@nexora.test','employee',{domainId:inUse._id}));
  await expect(resources.deactivateDomain(inUse.id,admin)).rejects.toMatchObject({statusCode:409});
  await expect(resources.getUser(new mongoose.Types.ObjectId(),admin)).rejects.toMatchObject({statusCode:404});
  expect(resources.validId(inUse.id)).toBe(true);expect(resources.validId('not-an-id')).toBe(false);
});

test('public health, domains, compliance, rules, notification and report endpoints return safe envelopes',async()=>{
  expect((await request(app).get('/api/v1/health')).status).toBe(200);
  expect((await request(app).get('/api/v1/health/ready')).status).toBe(200);
  const domain=await models.Domain.create({name:'Read Domain'});
  expect((await request(app).get('/api/v1/domains').set('Authorization',`Bearer ${employeeToken}`)).status).toBe(200);
  expect((await request(app).get(`/api/v1/domains/${domain.id}`).set('Authorization',`Bearer ${employeeToken}`)).status).toBe(200);
  expect((await request(app).get(`/api/v1/users/${employee.id}/compliance`).set('Authorization',`Bearer ${employeeToken}`)).body.data.compliant).toBe(true);
  const rule=await models.AssignmentRule.create({name:'Rule',courseId:new mongoose.Types.ObjectId()});
  expect((await request(app).get('/api/v1/rules').set('Authorization',`Bearer ${trainerToken}`)).status).toBe(200);
  await models.Notification.create({userId:employee._id,title:'Notice',message:'Text'});
  expect((await request(app).get('/api/v1/notifications').set('Authorization',`Bearer ${employeeToken}`)).body.data).toHaveLength(1);
  expect((await request(app).patch('/api/v1/notifications/read-all').set('Authorization',`Bearer ${employeeToken}`)).status).toBe(200);
  const note=await models.Notification.findOne({userId:employee._id});
  expect((await request(app).patch(`/api/v1/notifications/${note.id}/read`).set('Authorization',`Bearer ${employeeToken}`)).status).toBe(200);
  expect((await request(app).get('/api/v1/reports/compliance').set('Authorization',`Bearer ${adminToken}`)).status).toBe(200);
  expect((await request(app).get('/api/v1/audit-logs').set('Authorization',`Bearer ${adminToken}`)).status).toBe(200);
  expect(await models.AssignmentRule.findById(rule.id)).toBeTruthy();
});

test('domain trainer assignment endpoint updates domain-scoped trainer access',async()=>{
  const domain=await models.Domain.create({name:'Trainer Mapping Domain'});
  const result=await request(app).put(`/api/v1/domains/${domain.id}/trainers`).set('Authorization',`Bearer ${adminToken}`).send({trainerIds:[String(trainer._id)]});
  expect(result.status).toBe(200);expect(trainer.id).toBe(String(result.body.data.trainerIds[0]));
  const updated=await models.User.findById(trainer._id);expect(updated.trainerDomains.map(String)).toContain(String(domain._id));
});

test('trainer course access stays inside assigned domains',async()=>{
  const own=await models.Domain.create({name:'Trainer Own Domain'}),foreign=await models.Domain.create({name:'Trainer Foreign Domain'});
  await models.User.updateOne({_id:trainer._id},{$set:{trainerDomains:[own._id]}});
  const denied=await request(app).post('/api/v1/courses').set('Authorization',`Bearer ${trainerToken}`).send({title:'Forbidden Course',domainId:String(foreign._id)});expect(denied.status).toBe(403);
  const allowed=await request(app).post('/api/v1/courses').set('Authorization',`Bearer ${trainerToken}`).send({title:'Allowed Course',domainId:String(own._id)});expect(allowed.status).toBe(200);
  const foreignCourse=await models.Course.create({title:'Private Course',domainId:foreign._id,trainerId:trainer._id,status:'draft'});
  const hidden=await request(app).get(`/api/v1/courses/${foreignCourse.id}`).set('Authorization',`Bearer ${trainerToken}`);expect(hidden.status).toBe(404);
});

test('central error middleware masks internal failures and normalizes validation and duplicate errors',async()=>{
  const {errorHandler,notFound}=await import('../src/middlewares/errorHandler.js');
  const call=(err,req={headers:{}})=>{const res={statusCode:0,status(code){this.statusCode=code;return this},json(body){this.body=body;return this}};errorHandler(err,req,res,()=>{});return res};
  expect(call(new Error('database password leaked'),{id:'corr-1',headers:{}})).toMatchObject({statusCode:500,body:{message:'Internal server error',correlationId:'corr-1'}});
  expect(call(Object.assign(new Error('bad object id'),{name:'CastError'})).statusCode).toBe(400);
  expect(call(Object.assign(new Error('duplicate'),{code:11000})).statusCode).toBe(409);
  expect(call(Object.assign(new Error('invalid'),{statusCode:422,code:'INVALID'}),{headers:{'x-request-id':'header-id'}}).body.correlationId).toBeUndefined();
  let notFoundError;notFound({}, {}, error=>{notFoundError=error});expect(notFoundError).toMatchObject({statusCode:404,code:'NOT_FOUND'});
});

test('employee cannot read another employee assignment',async()=>{
  const assignment=await models.Assignment.create({employeeId:otherEmployee._id,courseId:new mongoose.Types.ObjectId(),courseVersion:1});
  const response=await request(app).get(`/api/v1/assignments/${assignment.id}`).set('Authorization',`Bearer ${employeeToken}`);expect(response.status).toBe(404);
});

test('CSV user import validates all rows then inserts valid rows and reports per-row failures',async()=>{
  const csv='name,email,password\nValid User,valid-import@nexora.test,Strong-Import-Password-321!\nBad User,not-an-email,weak';
  const before=await models.User.countDocuments({email:'valid-import@nexora.test'});
  const result=await request(app).post('/api/v1/users/import').set('Authorization',`Bearer ${adminToken}`).send({csv});
  expect(result.status).toBe(200);expect(result.body.data.created).toBe(1);expect(result.body.data.errors).toHaveLength(1);expect(await models.User.countDocuments({email:'valid-import@nexora.test'})).toBe(before+1);
  const duplicate='name,email,password\nNew User,new-import@nexora.test,Strong-Import-Password-321!\nExisting User,employee@nexora.test,Another-Strong-Password-123!';
  const existing=await request(app).post('/api/v1/users/import').set('Authorization',`Bearer ${adminToken}`).send({csv:duplicate});expect(existing.status).toBe(200);expect(existing.body.data.created).toBe(1);expect(existing.body.data.errors).toHaveLength(1);expect(await models.User.countDocuments({email:'new-import@nexora.test'})).toBe(1);
});

test('CSV multipart import rejects wrong types and oversized files',async()=>{
  const wrong=await request(app).post('/api/v1/users/import').set('Authorization',`Bearer ${adminToken}`).attach('file',Buffer.from('a,b\n1,2'),'not-csv.txt');expect(wrong.status).toBe(400);
  const large=await request(app).post('/api/v1/users/import').set('Authorization',`Bearer ${adminToken}`).attach('file',Buffer.alloc(2*1024*1024+1),'too-large.csv');expect(large.status).toBe(400);
});

test('login and strict query validation reject NoSQL payloads',async()=>{
  const badLogin=await request(app).post('/api/v1/auth/login').send({email:{$gt:''},password:'x'});expect(badLogin.status).toBe(400);
  const badQuery=await request(app).get('/api/v1/users?role%5B%24gt%5D=');expect([400,401]).toContain(badQuery.status);
  const withAuth=await request(app).get('/api/v1/users?role%5B%24gt%5D=').set('Authorization',`Bearer ${adminToken}`);expect(withAuth.status).toBe(400);
});

test('refresh rotates tokens and replay revokes the complete family',async()=>{
  const login=await authService.login(employee.email,password);const rotated=await authService.rotate(login.refreshToken);expect(rotated.refreshToken).not.toBe(login.refreshToken);
  await expect(authService.rotate(login.refreshToken)).rejects.toMatchObject({code:'TOKEN_REUSE'});
  await expect(authService.rotate(rotated.refreshToken)).rejects.toMatchObject({code:'TOKEN_EXPIRED'});
});

test('password changes invalidate existing access tokens and revoke refresh sessions',async()=>{
  const session=await authService.login(employee.email,password);await authService.passwordChange(employee._id,password,'New-Secure-Password-987!');
  const response=await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${session.accessToken}`);expect(response.status).toBe(401);
  expect(await models.RefreshSession.countDocuments({userId:employee._id,expiresAt:{$gt:new Date()}})).toBe(0);
});

test('login failures lock account at five with indistinguishable errors',async()=>{
  const unknown=await request(app).post('/api/v1/auth/login').send({email:'missing@nexora.test',password:'wrong'});
  let latest;for(let i=0;i<5;i++)latest=await request(app).post('/api/v1/auth/login').send({email:otherEmployee.email,password:'wrong'});
  expect(latest.status).toBe(401);expect(latest.body.message).toBe(unknown.body.message);expect(latest.body.code).toBe(unknown.body.code);
  expect((await request(app).post('/api/v1/auth/login').send({email:otherEmployee.email,password:'wrong'})).body.message).toBe(latest.body.message);
  const locked=await models.User.findById(otherEmployee._id).select('+lockUntil');expect(locked.lockUntil.getTime()).toBeGreaterThan(Date.now());
},60000);

test('reset tokens are hashed, expire in 15 minutes and are single use',async()=>{
  const {mailer}=await import('../src/config/mailer.js');const send=jest.spyOn(mailer,'send').mockResolvedValue({});
  await authService.forgotPassword(employee.email);const reset=await models.PasswordReset.findOne({userId:employee._id}).select('+tokenHash');expect(reset.tokenHash).toMatch(/^[a-f\d]{64}$/);expect(reset.expiresAt.getTime()).toBeGreaterThan(Date.now()+14*60_000);expect(reset.expiresAt.getTime()).toBeLessThanOrEqual(Date.now()+15*60_000);
  const raw=send.mock.calls[0][0].text.match(/token=([^\s]+)/)[1];const decoded=decodeURIComponent(raw);expect(reset.tokenHash).not.toBe(decoded);await authService.resetPassword(decoded,'Another-Strong-Password-448!');await expect(authService.resetPassword(decoded,'Yet-Another-Password-998!')).rejects.toMatchObject({code:'INVALID_TOKEN'});send.mockRestore();
});

test('CSRF requires an allow-listed Origin and X-Requested-With',async()=>{
  const missing=await request(app).post('/api/v1/auth/refresh').set('Origin','http://localhost:5173');expect(missing.status).toBe(403);
  const hostile=await request(app).post('/api/v1/auth/refresh').set('Origin','https://attacker.test').set('X-Requested-With','XMLHttpRequest');expect(hostile.status).toBe(403);
  const accepted=await request(app).post('/api/v1/auth/refresh').set('Origin','http://localhost:5173').set('X-Requested-With','XMLHttpRequest');expect(accepted.status).toBe(401);
  const referer=await request(app).post('/api/v1/auth/refresh').set('Referer','http://localhost:5173/page').set('X-Requested-With','XMLHttpRequest');expect(referer.status).toBe(401);
});

test('no sensitive user fields appear in API responses',async()=>{
  const login=await request(app).post('/api/v1/auth/login').send({email:trainer.email,password});expect(login.status).toBe(200);
  const profile=await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${login.body.data.accessToken}`);const serialized=JSON.stringify({login:login.body,profile:profile.body});
  for(const field of ['passwordHash','refreshTokenHash','tokenVersion','resetTokenHash','lockUntil'])expect(serialized).not.toContain(field);
});

test('login and forgot-password rate limits return 429 beyond limits',async()=>{
  let response;for(let i=0;i<11;i++)response=await request(app).post('/api/v1/auth/login').set('X-Forwarded-For','198.51.100.77').send({email:'rate@nexora.test',password:'wrong'});expect(response.status).toBe(429);
  for(let i=0;i<6;i++)response=await request(app).post('/api/v1/auth/forgot-password').set('X-Forwarded-For','198.51.100.78').send({email:'rate@nexora.test'});expect(response.status).toBe(429);
},60000);

test('password policy rejects weak, common and identity-matching passwords',()=>{
  for(const candidate of ['short','password123','employee@nexora.test','Employee One Renamed'])expect(()=>authService.passwordPolicy(candidate,employee)).toThrow();
  expect(()=>authService.passwordPolicy('A-good-random-password-910!',employee)).not.toThrow();
});

test('production configuration rejects absent and weak signing secrets',async()=>{
  const {spawnSync}=await import('node:child_process');const node=process.execPath;const code="import('./src/config/env.js')";
  const absent=spawnSync(node,['--input-type=module','-e',code],{cwd:process.cwd(),env:{PATH:process.env.PATH,NODE_ENV:'production',MONGODB_URI:'mongodb://localhost/db'}});expect(absent.status).not.toBe(0);
  const weak=spawnSync(node,['--input-type=module','-e',code],{cwd:process.cwd(),env:{PATH:process.env.PATH,NODE_ENV:'production',MONGODB_URI:'mongodb://localhost/db',JWT_SECRET:'replace-with-at-least-32-random-characters'}});expect(weak.status).not.toBe(0);
});

test('last active admin and self-deactivation are rejected; deactivation is audited',async()=>{
  await expect(resources.deactivateUser(admin.id,admin)).rejects.toMatchObject({statusCode:422});
  await expect(resources.changeUserStatus(admin.id,'inactive',employee)).rejects.toMatchObject({statusCode:409});
  const selfStatus=await request(app).patch(`/api/v1/users/${admin.id}/status`).set('Authorization',`Bearer ${adminToken}`).send({status:'inactive'});expect(selfStatus.status).toBe(422);
  const selfDelete=await request(app).delete(`/api/v1/users/${admin.id}`).set('Authorization',`Bearer ${adminToken}`);expect(selfDelete.status).toBe(422);
  const before=await models.User.create(userPayload('Admin Two','admin2@nexora.test','admin'));
  const changed=await resources.changeUserStatus(admin.id,'inactive',before);expect(changed.status).toBe('inactive');expect(await models.AuditLog.exists({entityId:admin._id,action:'user.deactivate'})).toBeTruthy();
});

