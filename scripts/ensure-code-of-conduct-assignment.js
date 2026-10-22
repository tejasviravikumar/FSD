import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import {
  Assignment,
  Assessment,
  Course,
  User,
} from '../src/models/index.js';

const targetEmail = 'software.engineering10@nexora.example';

async function ensureAssignment() {
  await connectDB();

  const employee = await User.findOne({
    email: targetEmail,
    role: 'employee',
    status: 'active',
    deletedAt: null,
  });

  if (!employee) {
    throw new Error(`Demo account not found: ${targetEmail}`);
  }

  const course = await Course.findOne({
    title: 'Code of Conduct',
    status: 'published',
  }).sort({ version: -1 });

  if (!course) {
    throw new Error(
      'Published Code of Conduct course not found. Seed the demo database first.'
    );
  }

  const assessment = await Assessment.findOne({ courseId: course._id });
  if (!assessment) {
    throw new Error('Code of Conduct quiz not found for the published course.');
  }

  let assignment = await Assignment.findOne({
    employeeId: employee._id,
    courseId: course._id,
    courseVersion: course.version,
    status: { $ne: 'cancelled' },
  });
  let created = false;

  if (!assignment) {
    const admin = await User.findOne({ role: 'admin', status: 'active' });
    assignment = await Assignment.create({
      employeeId: employee._id,
      courseId: course._id,
      courseVersion: course.version,
      cycle: 'none',
      source: 'manual',
      assignedBy: admin?._id,
      dueDate: new Date(Date.now() + 14 * 86400000),
      status: 'not_started',
      progressPercent: 0,
    });
    created = true;
  }

  console.log(
    JSON.stringify({
      employee: targetEmail,
      course: course.title,
      assignmentId: String(assignment._id),
      status: assignment.status,
      created,
    })
  );
}

ensureAssignment()
  .catch((error) => {
    console.error(`Could not repair Code of Conduct assignment: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
