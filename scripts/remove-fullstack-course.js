import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import {
  Assignment,
  AssignmentRule,
  Assessment,
  Attempt,
  Certificate,
  Course,
  ModuleProgress,
  Notification,
  Upload,
} from '../src/models/index.js';
import { localUploadStorage } from '../src/services/uploadStorage.js';
import { env } from '../src/config/env.js';

async function run() {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to remove course data in production');
  }

  await connectDB();

  if (!/nexora/i.test(mongoose.connection.name)) {
    throw new Error(
      `Refusing to change database "${mongoose.connection.name}"; expected a Nexora demo database`
    );
  }

  // Find the root course(s)
  const root = await Course.find({
    title: /^Full-Stack Web Development Fundamentals$/i,
  })
    .select('_id')
    .lean();
  const roots = root.map((course) => course._id);

  // Walk the version tree to collect every derived course version
  const allIds = new Map(roots.map((id) => [String(id), id]));
  let frontier = roots;

  while (frontier.length) {
    const versions = await Course.find({ versionOf: { $in: frontier } })
      .select('_id')
      .lean();

    frontier = versions
      .map((course) => course._id)
      .filter((id) => !allIds.has(String(id)));

    for (const id of frontier) {
      allIds.set(String(id), id);
    }
  }

  const courseIds = [...allIds.values()];

  if (!courseIds.length) {
    console.log('No Full-Stack Web Development Fundamentals course found.');
    return;
  }

  // Gather related records
  const assignmentIds = await Assignment.find({
    courseId: { $in: courseIds },
  }).distinct('_id');

  const certificates = await Certificate.find({ courseId: { $in: courseIds } })
    .select('_id uploadId')
    .lean();

  const moduleUploadIds = (
    await Course.find({ _id: { $in: courseIds } })
      .select('modules.uploadId')
      .lean()
  ).flatMap((course) =>
    course.modules.map((module) => module.uploadId).filter(Boolean)
  );

  const uploadIds = [
    ...new Set([
      ...certificates
        .map((cert) => cert.uploadId)
        .filter(Boolean)
        .map(String),
      ...moduleUploadIds.map(String),
    ]),
  ];

  const uploadQuery = uploadIds.length
    ? { $or: [{ _id: { $in: uploadIds } }, { courseId: { $in: courseIds } }] }
    : { courseId: { $in: courseIds } };

  const uploads = await Upload.find(uploadQuery)
    .select('_id storageName')
    .lean();

  // Remove files from storage first
  for (const upload of uploads) {
    await localUploadStorage.delete(upload.storageName);
  }

  const uploadRowIds = uploads.map((upload) => upload._id);

  // Delete database records
  const [
    assignments,
    assessments,
    rules,
    attempts,
    progress,
    certs,
    notices,
    uploadRows,
    courses,
  ] = await Promise.all([
    Assignment.deleteMany({ courseId: { $in: courseIds } }),
    Assessment.deleteMany({ courseId: { $in: courseIds } }),
    AssignmentRule.deleteMany({ courseId: { $in: courseIds } }),
    Attempt.deleteMany({
      $or: [
        { courseId: { $in: courseIds } },
        { assignmentId: { $in: assignmentIds } },
      ],
    }),
    ModuleProgress.deleteMany({
      $or: [
        { courseId: { $in: courseIds } },
        { assignmentId: { $in: assignmentIds } },
      ],
    }),
    Certificate.deleteMany({ courseId: { $in: courseIds } }),
    Notification.deleteMany({
      reminderKey: { $in: assignmentIds.map((id) => `assignment:new:${id}`) },
    }),
    Upload.deleteMany({ _id: { $in: uploadRowIds } }),
    Course.deleteMany({ _id: { $in: courseIds } }),
  ]);

  console.log(
    JSON.stringify(
      {
        removed: {
          courses: courses.deletedCount,
          assignments: assignments.deletedCount,
          assessments: assessments.deletedCount,
          rules: rules.deletedCount,
          attempts: attempts.deletedCount,
          moduleProgress: progress.deletedCount,
          certificates: certs.deletedCount,
          assignmentNotifications: notices.deletedCount,
          uploads: uploadRows.deletedCount,
        },
      },
      null,
      2
    )
  );
}

run()
  .catch((error) => {
    console.error(`Course removal failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());