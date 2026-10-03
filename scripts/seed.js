import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {connectDB} from '../src/config/db.js';
import {Assignment,AssignmentRule,Assessment,AuditLog,Attempt,Certificate,CertificateCounter,Course,Domain,ModuleProgress,Notification,PasswordReset,ReminderLog,RefreshSession,Settings,Upload,User} from '../src/models/index.js';
import {localUploadStorage} from '../src/services/uploadStorage.js';
import {env} from '../src/config/env.js';

const adminPassword=process.env.SEED_ADMIN_PASSWORD||'NexoraDemo!2026';
const employeePassword=process.env.SEED_EMPLOYEE_PASSWORD||'TrainingDemo!2026';
const domainSpecs=[['Software / IT','IT'],['Manufacturing','MFG'],['Finance','FIN'],['HR','HR'],['Sales & Marketing','SALES'],['Logistics','LOG'],['Common','COMMON']];
const locations=['Mumbai','Pune','Bengaluru','Delhi','Hyderabad','Chennai'];
const levels=['new_joiner','junior','mid','senior','team_lead','manager'];
const teams=['Software Engineering','IT Support','Manufacturing Operations','Quality Assurance','Financial Planning','People Operations','Sales','Marketing','Logistics'];
const peopleNames=['Aarav Mehta','Aditi Shah','Advait Rao','Ananya Iyer','Arjun Nair','Avani Desai','Dhruv Kapoor','Diya Menon','Ishaan Kulkarni','Isha Reddy','Kabir Bhat','Kavya Joshi','Krish Malhotra','Mira Pillai','Neel Banerjee','Nisha Verma','Omkar Patil','Pari Sethi','Pranav Bose','Rhea Thomas','Rohan Gupta','Saanvi Rao','Sameer Khanna','Sara Fernandes','Shaurya Jain','Shreya Das','Siddharth Roy','Tara Mukherjee','Uday Naidu','Vanya Arora','Vihaan Sen','Yashika Paul','Aditya Sinha','Amara Dutta','Devika Rao','Eshan Kapoor','Gauri Kulkarni','Harini Menon','Ibrahim Khan','Jhanvi Shah','Karan Bedi','Lavanya Iyer','Manav Desai','Nandini Bose','Ojas Mehta','Pooja Nair','Rahul Bhat','Sakshi Verma','Tanvi Joshi','Varun Pillai','Zoya Mirza','Abhay Reddy','Bhavna Shah','Chirag Patel','Deepa Menon','Farhan Ali','Geetika Sethi','Hemant Rao','Indira Das','Jayant Bose'];
const domains=[],trainers=[],managers=[],employees=[];
const allModels=[User,Domain,Course,Assignment,AssignmentRule,Assessment,ModuleProgress,Attempt,Certificate,CertificateCounter,ReminderLog,AuditLog,Notification,RefreshSession,PasswordReset,Settings,Upload];
const pick=(items,index)=>items[index%items.length];
const designationEmail=(designation,index)=>`${designation.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'')}${String(index+1).padStart(2,'0')}@nexora.example`;
const passwordHash=password=>bcrypt.hash(password,12);
const randomName=()=>peopleNames.splice(Math.floor(Math.random()*peopleNames.length),1)[0];
async function wipeApplicationData(){const uploads=await Upload.find().select('storageName').lean();for(const upload of uploads)await localUploadStorage.delete(upload.storageName);await Promise.all(allModels.map(Model=>Model.deleteMany({})))}
async function createUsers(admin){
 for(let i=0;i<14;i++){const domain=domains[Math.floor(i/2)],email=`trainer${String(i+1).padStart(2,'0')}@nexora.example`;trainers.push(await User.create({name:randomName(),email,passwordHash:await passwordHash(employeePassword),role:'trainer',trainerDomains:[domain._id],status:'active',forcePasswordChange:false}))}
 for(let i=0;i<4;i++){const domain=domains[i%6],email=designationEmail('Department Manager',i);managers.push(await User.create({name:randomName(),email,passwordHash:await passwordHash(employeePassword),role:'employee',domainId:domain._id,designation:'Department Manager',level:'manager',location:pick(locations,i),status:'active',forcePasswordChange:false}))}
 for(let i=0;i<36;i++){const domain=domains[i%6],team=pick(teams,i),isNewJoiner=i%9===0,email=designationEmail(team,i);employees.push(await User.create({name:randomName(),email,passwordHash:await passwordHash(employeePassword),role:'employee',domainId:domain._id,designation:team,level:isNewJoiner?'new_joiner':pick(levels.slice(1,5),i),location:pick(locations,i+2),tags:i%5===0?['safety','new-hire']:['general'],managerId:managers[i%managers.length]._id,joinedOn:new Date(Date.now()-(isNewJoiner?10:60+i*8)*86400000),status:'active',forcePasswordChange:false}))}
 return admin;
}
async function run(){
 if(env.NODE_ENV==='production')throw new Error('Refusing to wipe application data when NODE_ENV=production');
 await connectDB();if(!/nexora/i.test(mongoose.connection.name))throw new Error(`Refusing to seed database "${mongoose.connection.name}"; set MONGODB_URI to a Nexora demo database name`);await wipeApplicationData();
 for(const [name,code] of domainSpecs)domains.push(await Domain.create({name,description:`Nexora Industries ${name} learning domain. Code: ${code}.`,isCommon:code==='COMMON',isActive:true}));
 const admin=await User.create({name:randomName(),email:'admin@nexora.example',passwordHash:await passwordHash(adminPassword),role:'admin',status:'active',forcePasswordChange:false});
 await createUsers(admin);
 console.log('Nexora Industries starter database seeded with no default courses.');console.log(`Admin login: admin@nexora.example / ${adminPassword}`);console.log(`Trainer and employee demo password: ${employeePassword}`);console.log(`Created ${domains.length} domains and ${trainers.length} trainers plus ${managers.length+employees.length} employee accounts (${managers.length} managers). Add courses from the admin interface.`);
}
run().catch(error=>{console.error('Seed failed:',error);process.exitCode=1}).finally(()=>mongoose.disconnect());
