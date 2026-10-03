import mongoose from 'mongoose';
import fs from 'node:fs';
import { connectDB } from '../src/config/db.js';
import { Course } from '../src/models/index.js';
import { demoCourseResources } from './demoCourseResources.js';
const courseVideoRecords = JSON.parse(fs.readFileSync(new URL('../docs/course-video-dataset.json', import.meta.url), 'utf8'));

async function repairDemoResources() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to change demo course resources when NODE_ENV=production');
  await connectDB();
  if (!/nexora/i.test(mongoose.connection.name)) throw new Error(`Refusing to update database "${mongoose.connection.name}"; set MONGODB_URI to a Nexora demo database`);

  let updated = 0;
  for (const course of await Course.find({ title: { $in: Object.keys(demoCourseResources) } })) {
    let moduleIndex = course.modules.findIndex(item => item.type === 'youtube' && (item.youtubeVideoId?.startsWith('NexDemo') || item.notes?.includes('DEMO PLACEHOLDER')));
    if (moduleIndex < 0 && !course.modules.some(item => item.type === 'youtube')) moduleIndex = course.modules.findIndex(item => item.type === 'note' && item.title === `${course.title} essentials`);
    if (moduleIndex < 0) continue;
    const videos = courseVideoRecords.filter(video => video.course === course.title);
    if (!videos.length) continue;
    const videoModules = videos.map((video, index) => ({ title: video.moduleTitle, order: index + 1, type: 'youtube', youtubeVideoId: video.videoId, durationSeconds: video.durationSeconds, completionThreshold: 90, isRequired: video.required }));
    course.modules.splice(moduleIndex, 1, ...videoModules);
    course.modules.forEach((item, index) => { item.order = index + 1 });
    if (!course.modules.some(item => item.type === 'note')) course.modules.push({ title: `${course.title} essentials`, order: course.modules.length + 1, type: 'note', notes: demoCourseResources[course.title], isRequired: true });
    course.description = `Nexora Industries learning module for ${course.title.toLowerCase()}.`;
    await course.save();
    updated++;
  }
  console.log(`Updated ${updated} demo courses with verified YouTube lessons and built-in readings. Run again safely; already updated courses are skipped.`);
}

repairDemoResources().catch(error => { console.error('Demo resource repair failed:', error); process.exitCode = 1 }).finally(() => mongoose.disconnect());
