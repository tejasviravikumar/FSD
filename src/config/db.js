import mongoose from 'mongoose';
import { env } from './env.js';
export const connectDB=()=>mongoose.connect(env.MONGODB_URI);
