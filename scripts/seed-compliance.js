import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Assignment, Course, Domain, User } from '../src/models/index.js';
import { env } from '../src/config/env.js';

const demoCourses = [
  ['Demo Compliance: Information Security', 'Security basics, account protection, and incident reporting.'],
  ['Demo Compliance: Data Privacy', 'Handling personal information and following privacy requirements.'],
  ['Demo Compliance: Workplace Safety', 'Safe work practices, hazard reporting, and emergency response.'],
  ['Demo Compliance: Code of Conduct', 'Respectful workplace expectations and reporting concerns.'],
  ['Demo Compliance: Data Handling', 'Classification, storage, and retention of company information.'],
];

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const dateFromToday = (days) => new Date(Date.now() + days * 86400000);

async function run() {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to add demo compliance data in production');
  }

  await connectDB();
  if (!/nexora/i.test(mongoose.connection.name)) {
    throw new Error(`Refusing to add demo data to database "${mongoose.connection.name}"; use a Nexora demo database`);
  }

  const [commonDomain, trainer, employees] = await Promise.all([
    Domain.findOne({ isCommon: true, isActive: true }),
    User.findOne({ role: 'trainer', status: 'active' }).sort({ createdAt: 1 }),
    User.find({ role: { $in: ['employee', 'manager'] }, status: 'active' }).select('_id'),
  ]);
  if (!commonDomain || !trainer || employees.length === 0) {
    throw new Error('Seed domains, an active trainer, and employee accounts before adding compliance data');
  }

  let coursesAdded = 0;
  for (const [title, description] of demoCourses) {
    const existing = await Course.findOne({ title, domainId: commonDomain._id });
    if (existing) continue;
    await Course.create({
      title,
      description,
      domainId: commonDomain._id,
      trainerId: trainer._id,
      status: 'published',
      isMandatory: true,
      validityMonths: null,
      passMark: 70,
      maxAttempts: 3,
      estimatedMinutes: 20,
      tags: ['demo', 'compliance'],
      modules: [{ title: 'Course overview', order: 1, type: 'note', notes: description, isRequired: true }],
      publishedAt: new Date(),
      approvedBy: trainer._id,
    });
    coursesAdded += 1;
  }

  const courses = await Course.find({ domainId: commonDomain._id, status: 'published', isMandatory: true, tags: 'compliance' });
  let assignmentsUpdated = 0;
  const cycle = `demo-${new Date().getUTCFullYear()}`;
  for (const employee of employees) {
    for (const course of courses) {
      const state = Math.random();
      if (state < 0.2) {
        await Assignment.deleteOne({ employeeId: employee._id, courseId: course._id, courseVersion: course.version, cycle });
        continue; // Leave the course missing for this employee.
      }

      const status = state < 0.42 ? 'in_progress' : state < 0.70 ? 'overdue' : 'completed';
      const now = new Date();
      const dueDate = status === 'overdue' ? dateFromToday(-randomInt(1, 45)) : dateFromToday(randomInt(7, 90));
      const update = {
        employeeId: employee._id,
        courseId: course._id,
        courseVersion: course.version,
        cycle,
        source: 'onboarding',
        assignedBy: trainer._id,
        dueDate,
        status,
        progressPercent: status === 'completed' ? 100 : status === 'in_progress' ? randomInt(10, 85) : 0,
        ...(status === 'completed' ? { completedAt: dateFromToday(-randomInt(1, 180)) } : {}),
        ...(status === 'in_progress' ? { startedAt: dateFromToday(-randomInt(1, 30)) } : {}),
      };
      await Assignment.findOneAndUpdate(
        { employeeId: employee._id, courseId: course._id, courseVersion: course.version, cycle },
        { $set: update },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      assignmentsUpdated += 1;
    }
  }

  console.log(`Added ${coursesAdded} demo mandatory courses; randomized ${assignmentsUpdated} employee assignments across ${courses.length} courses.`);
}

run()
  .catch((error) => {
    console.error('Compliance data seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
