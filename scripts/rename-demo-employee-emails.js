import mongoose from 'mongoose';
import {connectDB} from '../src/config/db.js';
import {User} from '../src/models/index.js';
import {env} from '../src/config/env.js';

const slug=value=>String(value||'employee').toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'')||'employee';

async function run(){
 if(env.NODE_ENV==='production')throw new Error('Refusing to rename accounts when NODE_ENV=production');
 await connectDB();
 if(!/nexora/i.test(mongoose.connection.name))throw new Error(`Refusing to update database "${mongoose.connection.name}"; use a Nexora demo database`);
 const users=await User.find({role:'employee',email:/^(employee|manager)\d+@nexora\.example$/i}).select('email designation').sort({email:1});
 let changed=0;
 for(const user of users){
  const suffix=user.email.match(/(\d+)@nexora\.example$/i)?.[1];
  if(!suffix)continue;
  const nextEmail=`${slug(user.designation)}${suffix}@nexora.example`;
  if(await User.exists({email:nextEmail,_id:{$ne:user._id}}))throw new Error(`Email already exists; no safe rename for ${user.email} -> ${nextEmail}`);
  const oldEmail=user.email;
  user.email=nextEmail;
  await user.save();
  changed++;
  console.log(`${oldEmail} -> ${nextEmail}`);
 }
 console.log(`Updated ${changed} demo employee email(s).`);
}

run().catch(error=>{console.error('Email rename failed:',error);process.exitCode=1}).finally(()=>mongoose.disconnect());
