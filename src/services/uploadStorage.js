import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileTypeFromBuffer} from 'file-type';
import {env} from '../config/env.js';
import {Upload} from '../models/index.js';
import {AppError} from '../utils/AppError.js';

const root=()=>{const resolved=path.resolve(env.UPLOAD_DIR),staticRoots=['public','client/public','client/src/assets'].map(p=>path.resolve(p));if(staticRoots.some(p=>resolved===p||resolved.startsWith(p+path.sep)))throw new Error('UPLOAD_DIR must be outside static asset directories');return resolved;}, extensions={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'};
// Replace this no-op with a scanner adapter before accepting untrusted production uploads.
export async function scanUploadedBuffer(_buffer){return{clean:true};}
export const localUploadStorage={async put(storageName,buffer){await mkdir(root(),{recursive:true});await writeFile(path.join(root(),storageName),buffer,{flag:'wx',mode:0o600});},get(storageName){return readFile(path.join(root(),storageName));},async delete(storageName){try{await unlink(path.join(root(),storageName))}catch(error){if(error.code!=='ENOENT')throw error;}}};
export async function saveUpload(file,actor,courseId){
  if(!file||!Buffer.isBuffer(file.buffer)||file.size>5*1024*1024)throw new AppError(400,'Upload must be at most 5 MB','INVALID_UPLOAD');
  const ext=file.originalname.toLowerCase().split('.').pop(),detected=await fileTypeFromBuffer(file.buffer);
  if(!detected||!extensions[detected.mime]||detected.mime!==file.mimetype||extensions[detected.mime]!==ext)throw new AppError(400,'File extension, MIME type and contents must match PDF, JPG or PNG','INVALID_UPLOAD');
  const scan=await scanUploadedBuffer(file.buffer);if(!scan.clean)throw new AppError(422,'Upload failed security scanning','UPLOAD_REJECTED');
  const storageName=`${crypto.randomUUID()}.${extensions[detected.mime]}`;
  await localUploadStorage.put(storageName,file.buffer);
  const originalName=path.basename(file.originalname).replace(/[\x00-\x1f\x7f"\\/]/g,'_').slice(0,255)||`upload.${extensions[detected.mime]}`;
  try{return await Upload.create({storageName,originalName,mimeType:detected.mime,size:file.size,uploadedBy:actor._id,courseId});}
  catch(error){await localUploadStorage.delete(storageName);throw error;}
}
