import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({ NODE_ENV:z.enum(['development','test','production']).default('development'), PORT:z.coerce.number().int().positive().default(4000), MONGODB_URI:z.string().min(1), JWT_SECRET:z.string().min(32), JWT_ISSUER:z.string().default('nexora-training-api'), JWT_AUDIENCE:z.string().default('nexora-training-client'), CORS_ORIGINS:z.string().default('http://localhost:5173'), COOKIE_SECURE:z.enum(['true','false']).default('false'), TIMEZONE:z.string().default('Asia/Kolkata'), UPLOAD_DIR:z.string().default('./private_uploads'), RESET_URL_BASE:z.string().default('http://localhost:5173/reset-password'), MAILER_TRANSPORT:z.enum(['console','smtp']).default('console'), SMTP_HOST:z.string().optional(), SMTP_PORT:z.coerce.number().default(587), SMTP_USER:z.string().optional(), SMTP_PASSWORD:z.string().optional(), MAIL_FROM:z.string().optional(), YOUTUBE_API_KEY:z.string().optional() });
const result=schema.safeParse(process.env); if(!result.success) throw new Error(`Invalid environment: ${result.error.issues.map(x=>x.path.join('.')+' '+x.message).join('; ')}`);
if(result.data.NODE_ENV==='production'&&(/replace|change.?me|secret/i.test(result.data.JWT_SECRET)||result.data.JWT_SECRET.length<32)) throw new Error('JWT_SECRET must be a strong production secret');
if(result.data.NODE_ENV==='production'&&result.data.COOKIE_SECURE!=='true') throw new Error('COOKIE_SECURE=true is required in production');
if(result.data.NODE_ENV==='production'&&result.data.MAILER_TRANSPORT!=='smtp') throw new Error('MAILER_TRANSPORT=smtp is required in production');
const origins=result.data.CORS_ORIGINS.split(',').map(x=>x.trim());
if(origins.includes('*'))throw new Error('CORS_ORIGINS must not use a wildcard with credentialed requests');
for(const origin of origins){try{if(new URL(origin).origin!==origin)throw new Error()}catch{throw new Error(`Invalid CORS origin: ${origin}`)}}
export const env=result.data;
