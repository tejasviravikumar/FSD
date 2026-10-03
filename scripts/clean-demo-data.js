import mongoose from 'mongoose';
import {connectDB} from '../src/config/db.js';
import {Assignment,AssignmentRule,Assessment,Attempt,Certificate,Course,ModuleProgress,Upload,User} from '../src/models/index.js';
import {localUploadStorage} from '../src/services/uploadStorage.js';
import {env} from '../src/config/env.js';

const defaultTitles=['Workplace Safety','Information Security','Code of Conduct','Privacy Essentials','Incident Response','Secure Development','Quality Management','Customer Care','Operational Excellence','Data Handling','Leadership Basics','Business Continuity','Financial Controls','Inclusive Workplace','Environmental Awareness'];
const names=['Aarav Mehta','Aditi Shah','Advait Rao','Ananya Iyer','Arjun Nair','Avani Desai','Dhruv Kapoor','Diya Menon','Ishaan Kulkarni','Isha Reddy','Kabir Bhat','Kavya Joshi','Krish Malhotra','Mira Pillai','Neel Banerjee','Nisha Verma','Omkar Patil','Pari Sethi','Pranav Bose','Rhea Thomas','Rohan Gupta','Saanvi Rao','Sameer Khanna','Sara Fernandes','Shaurya Jain','Shreya Das','Siddharth Roy','Tara Mukherjee','Uday Naidu','Vanya Arora','Vihaan Sen','Yashika Paul','Aditya Sinha','Amara Dutta','Devika Rao','Eshan Kapoor','Gauri Kulkarni','Harini Menon','Ibrahim Khan','Jhanvi Shah','Karan Bedi','Lavanya Iyer','Manav Desai','Nandini Bose','Ojas Mehta','Pooja Nair','Rahul Bhat','Sakshi Verma','Tanvi Joshi','Varun Pillai','Zoya Mirza','Abhay Reddy','Bhavna Shah','Chirag Patel','Deepa Menon','Farhan Ali','Geetika Sethi','Hemant Rao','Indira Das','Jayant Bose'];

async function run(){
 if(env.NODE_ENV==='production')throw new Error('Refusing to change application data when NODE_ENV=production');
 await connectDB();
 if(!/nexora/i.test(mongoose.connection.name))throw new Error(`Refusing to change database "${mongoose.connection.name}"; set MONGODB_URI to a Nexora demo database name`);
 const courses=await Course.find({title:{$in:defaultTitles}}).select('_id').lean(),courseIds=courses.map(course=>course._id);
 const assignments=courseIds.length?await Assignment.find({courseId:{$in:courseIds}}).distinct('_id'):[],certificates=courseIds.length?await Certificate.find({courseId:{$in:courseIds}}).select('_id uploadId').lean():[];
 const uploadIds=certificates.map(c=>c.uploadId).filter(Boolean),uploads=uploadIds.length?await Upload.find({_id:{$in:uploadIds}}).select('storageName').lean():[];
 for(const upload of uploads)await localUploadStorage.delete(upload.storageName);
 await Promise.all([
  Assignment.deleteMany({courseId:{$in:courseIds}}),AssignmentRule.deleteMany({courseId:{$in:courseIds}}),Assessment.deleteMany({courseId:{$in:courseIds}}),
  Attempt.deleteMany({$or:[{courseId:{$in:courseIds}},{assignmentId:{$in:assignments}}]}),ModuleProgress.deleteMany({$or:[{courseId:{$in:courseIds}},{assignmentId:{$in:assignments}}]}),
  Certificate.deleteMany({courseId:{$in:courseIds}}),Upload.deleteMany({_id:{$in:uploadIds}}),Course.deleteMany({_id:{$in:courseIds}})
 ]);

 const genericUsers=await User.find({$or:[{name:/^Nexora(?:\s|$)/i},{name:/\b(?:Trainer|Manager)\s*\d*$/i}]}).select('_id').lean();
 const shuffled=[...names].sort(()=>Math.random()-.5);
 for(let i=0;i<genericUsers.length;i++)await User.updateOne({_id:genericUsers[i]._id},{$set:{name:shuffled[i%shuffled.length]}});

 const pending=await Certificate.find({status:'pending_verification'}).sort({createdAt:1,_id:1}).select('_id employeeId courseId title issueDate expiryDate uploadId').lean();
 const seen=new Set(),duplicateIds=[],duplicateUploads=[];
 for(const cert of pending){const key=[cert.employeeId,cert.courseId,cert.title,cert.issueDate?.toISOString().slice(0,10),cert.expiryDate?.toISOString().slice(0,10)].join('|');if(seen.has(key)){duplicateIds.push(cert._id);if(cert.uploadId)duplicateUploads.push(cert.uploadId)}else seen.add(key)}
 const duplicateFiles=duplicateUploads.length?await Upload.find({_id:{$in:duplicateUploads}}).select('storageName').lean():[];
 for(const upload of duplicateFiles)await localUploadStorage.delete(upload.storageName);
 await Promise.all([Certificate.deleteMany({_id:{$in:duplicateIds}}),Upload.deleteMany({_id:{$in:duplicateUploads}})]);
 console.log(`Removed ${courseIds.length} default courses and related learning records; renamed ${genericUsers.length} generic demo users; removed ${duplicateIds.length} duplicate pending certificates.`);
}
run().catch(error=>{console.error('Demo data cleanup failed:',error);process.exitCode=1}).finally(()=>mongoose.disconnect());
