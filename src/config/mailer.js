import nodemailer from 'nodemailer';
import { env } from './env.js';
import { logger } from './logger.js';
export const consoleMailer={async send({to,subject,text}){logger.info({to,subject,text},'Development email')}};
export function createSmtpMailer(){if(!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASSWORD||!env.MAIL_FROM)throw new Error('SMTP settings are required when MAILER_TRANSPORT=smtp');const transport=nodemailer.createTransport({host:env.SMTP_HOST,port:env.SMTP_PORT,secure:env.SMTP_PORT===465,requireTLS:env.SMTP_PORT!==465,auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:20000});return{send:({to,subject,text})=>transport.sendMail({from:env.MAIL_FROM,to,subject,text})}}
export const mailer=env.MAILER_TRANSPORT==='smtp'?createSmtpMailer():consoleMailer;
