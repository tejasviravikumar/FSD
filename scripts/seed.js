import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import {
  Assignment,
  AssignmentRule,
  Assessment,
  AuditLog,
  Attempt,
  Certificate,
  CertificateCounter,
  Course,
  Domain,
  ModuleProgress,
  Notification,
  PasswordReset,
  ReminderLog,
  RefreshSession,
  Settings,
  Upload,
  User,
} from '../src/models/index.js';
import { localUploadStorage } from '../src/services/uploadStorage.js';
import { env } from '../src/config/env.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'NexoraDemo!2026';
const employeePassword =
  process.env.SEED_EMPLOYEE_PASSWORD || 'TrainingDemo!2026';

const domainSpecs = [
  ['Software / IT', 'IT'],
  ['Manufacturing', 'MFG'],
  ['Finance', 'FIN'],
  ['HR', 'HR'],
  ['Sales & Marketing', 'SALES'],
  ['Logistics', 'LOG'],
  ['Common', 'COMMON'],
];

const locations = [
  'Mumbai',
  'Pune',
  'Bengaluru',
  'Delhi',
  'Hyderabad',
  'Chennai',
];

const levels = [
  'new_joiner',
  'junior',
  'mid',
  'senior',
  'team_lead',
  'manager',
];

const teams = [
  'Software Engineering',
  'IT Support',
  'Manufacturing Operations',
  'Quality Assurance',
  'Financial Planning',
  'People Operations',
  'Sales',
  'Marketing',
  'Logistics',
];

const peopleNames = [
  'Aarav Mehta',
  'Aditi Shah',
  'Advait Rao',
  'Ananya Iyer',
  'Arjun Nair',
  'Avani Desai',
  'Dhruv Kapoor',
  'Diya Menon',
  'Ishaan Kulkarni',
  'Isha Reddy',
  'Kabir Bhat',
  'Kavya Joshi',
  'Krish Malhotra',
  'Mira Pillai',
  'Neel Banerjee',
  'Nisha Verma',
  'Omkar Patil',
  'Pari Sethi',
  'Pranav Bose',
  'Rhea Thomas',
  'Rohan Gupta',
  'Saanvi Rao',
  'Sameer Khanna',
  'Sara Fernandes',
  'Shaurya Jain',
  'Shreya Das',
  'Siddharth Roy',
  'Tara Mukherjee',
  'Uday Naidu',
  'Vanya Arora',
  'Vihaan Sen',
  'Yashika Paul',
  'Aditya Sinha',
  'Amara Dutta',
  'Devika Rao',
  'Eshan Kapoor',
  'Gauri Kulkarni',
  'Harini Menon',
  'Ibrahim Khan',
  'Jhanvi Shah',
  'Karan Bedi',
  'Lavanya Iyer',
  'Manav Desai',
  'Nandini Bose',
  'Ojas Mehta',
  'Pooja Nair',
  'Rahul Bhat',
  'Sakshi Verma',
  'Tanvi Joshi',
  'Varun Pillai',
  'Zoya Mirza',
  'Abhay Reddy',
  'Bhavna Shah',
  'Chirag Patel',
  'Deepa Menon',
  'Farhan Ali',
  'Geetika Sethi',
  'Hemant Rao',
  'Indira Das',
  'Jayant Bose',
];

const allModels = [
  User,
  Domain,
  Course,
  Assignment,
  AssignmentRule,
  Assessment,
  ModuleProgress,
  Attempt,
  Certificate,
  CertificateCounter,
  ReminderLog,
  AuditLog,
  Notification,
  RefreshSession,
  PasswordReset,
  Settings,
  Upload,
];

// Collections filled in during seeding
const domains = [];
const trainers = [];
const managers = [];
const employees = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pick = (items, index) => items[index % items.length];

const designationEmail = (designation, index) =>
  `${designation
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')}${String(index + 1).padStart(2, '0')}@nexora.example`;

const passwordHash = (password) => bcrypt.hash(password, 12);

// Removes and returns a random name so no name is used twice
const randomName = () =>
  peopleNames.splice(Math.floor(Math.random() * peopleNames.length), 1)[0];

async function wipeApplicationData() {
  const uploads = await Upload.find().select('storageName').lean();

  for (const upload of uploads) {
    await localUploadStorage.delete(upload.storageName);
  }

  await Promise.all(allModels.map((Model) => Model.deleteMany({})));
}

// ---------------------------------------------------------------------------
// User creation
// ---------------------------------------------------------------------------

async function createUsers(admin) {
  // Trainers: 14 accounts, two per domain
  for (let i = 0; i < 14; i++) {
    const domain = domains[Math.floor(i / 2)];
    const email = `trainer${String(i + 1).padStart(2, '0')}@nexora.example`;

    trainers.push(
      await User.create({
        name: randomName(),
        email,
        passwordHash: await passwordHash(employeePassword),
        role: 'trainer',
        trainerDomains: [domain._id],
        status: 'active',
        forcePasswordChange: false,
      })
    );
  }

  // Department managers: 4 accounts
  for (let i = 0; i < 4; i++) {
    const domain = domains[i % 6];
    const email = designationEmail('Department Manager', i);

    managers.push(
      await User.create({
        name: randomName(),
        email,
        passwordHash: await passwordHash(employeePassword),
        role: 'employee',
        domainId: domain._id,
        designation: 'Department Manager',
        level: 'manager',
        location: pick(locations, i),
        status: 'active',
        forcePasswordChange: false,
      })
    );
  }

  // Employees: 36 accounts, every ninth is a new joiner
  for (let i = 0; i < 36; i++) {
    const domain = domains[i % 6];
    const team = pick(teams, i);
    const isNewJoiner = i % 9 === 0;
    const email = designationEmail(team, i);

    employees.push(
      await User.create({
        name: randomName(),
        email,
        passwordHash: await passwordHash(employeePassword),
        role: 'employee',
        domainId: domain._id,
        designation: team,
        level: isNewJoiner ? 'new_joiner' : pick(levels.slice(1, 5), i),
        location: pick(locations, i + 2),
        tags: i % 5 === 0 ? ['safety', 'new-hire'] : ['general'],
        managerId: managers[i % managers.length]._id,
        joinedOn: new Date(
          Date.now() - (isNewJoiner ? 10 : 60 + i * 8) * 86400000
        ),
        status: 'active',
        forcePasswordChange: false,
      })
    );
  }

  return admin;
}

// Creates a single, individually assigned Code of Conduct quiz for demo
// account software.engineering10@nexora.example.
async function createCodeOfConductAssignment(admin) {
  const employee = await User.findOne({
    email: 'software.engineering10@nexora.example',
    role: 'employee',
    status: 'active',
    deletedAt: null,
  });

  if (!employee) {
    throw new Error('Could not find the Software Engineer 10 demo account');
  }

  const commonDomain = domains.find((domain) => domain.isCommon);
  const trainer = trainers.find((user) =>
    user.trainerDomains.some((domainId) => String(domainId) === String(commonDomain._id))
  );

  const course = await Course.create({
    title: 'Code of Conduct',
    description:
      'Learn Nexora expectations for respectful, ethical, and responsible conduct at work.',
    domainId: commonDomain._id,
    trainerId: trainer._id,
    version: 1,
    status: 'published',
    isMandatory: true,
    passMark: 80,
    maxAttempts: 3,
    estimatedMinutes: 15,
    tags: ['code-of-conduct', 'ethics', 'workplace'],
    eligibility: { userIds: [String(employee._id)] },
    modules: [
      {
        title: 'Code of Conduct: Key Principles',
        order: 1,
        type: 'note',
        isRequired: true,
        notes:
          'Treat everyone with respect. Act honestly and fairly. Protect confidential and personal information. Disclose conflicts of interest. Use company resources responsibly. Report suspected misconduct through an appropriate manager or reporting channel. Retaliation against a person who raises a concern in good faith is not acceptable.',
      },
    ],
    publishedAt: new Date(),
    approvedBy: admin._id,
  });

  await Assessment.create({
    courseId: course._id,
    timeLimitMinutes: 15,
    shuffleQuestions: true,
    shuffleOptions: true,
    questions: [
      {
        text: 'A colleague makes repeated insulting comments about another employee. What should you do?',
        type: 'single_choice',
        options: [
          { text: 'Ignore it because it is not directed at you', isCorrect: false },
          { text: 'Report the concern through an appropriate manager or reporting channel', isCorrect: true },
          { text: 'Post about it publicly on social media', isCorrect: false },
        ],
        explanation: 'Workplace concerns should be raised through appropriate internal channels.',
        marks: 1,
      },
      {
        text: 'You discover that a decision may benefit a close family member. What is the best action?',
        type: 'single_choice',
        options: [
          { text: 'Disclose the potential conflict and seek guidance before proceeding', isCorrect: true },
          { text: 'Proceed as usual as long as nobody notices', isCorrect: false },
          { text: 'Ask the family member to keep it secret', isCorrect: false },
        ],
        explanation: 'Potential conflicts should be disclosed so they can be assessed and managed.',
        marks: 1,
      },
      {
        text: 'How should confidential employee information be handled?',
        type: 'single_choice',
        options: [
          { text: 'Share it only with people who are authorized and need it for work', isCorrect: true },
          { text: 'Send it to a personal email account for convenience', isCorrect: false },
          { text: 'Discuss it in public spaces if names are omitted', isCorrect: false },
        ],
        explanation: 'Confidential information must be protected and accessed only for legitimate work needs.',
        marks: 1,
      },
      {
        text: 'A supplier offers you an expensive personal gift while a contract decision is pending. What should you do?',
        type: 'single_choice',
        options: [
          { text: 'Accept it and keep it private', isCorrect: false },
          { text: 'Decline it and disclose the offer according to company policy', isCorrect: true },
          { text: 'Accept it if the supplier says it is customary', isCorrect: false },
        ],
        explanation: 'Gifts that could influence, or appear to influence, a business decision must be handled transparently.',
        marks: 1,
      },
      {
        text: 'You notice a coworker using company equipment for a prohibited personal business. What should you do?',
        type: 'single_choice',
        options: [
          { text: 'Raise the concern through an appropriate channel', isCorrect: true },
          { text: 'Join in because the equipment is available', isCorrect: false },
          { text: 'Take the equipment home as well', isCorrect: false },
        ],
        explanation: 'Company resources should be used responsibly and in line with policy.',
        marks: 1,
      },
      {
        text: 'What is expected when you raise a concern in good faith?',
        type: 'single_choice',
        options: [
          { text: 'You should expect retaliation as part of the process', isCorrect: false },
          { text: 'Retaliation is not acceptable', isCorrect: true },
          { text: 'You must first prove the concern yourself', isCorrect: false },
        ],
        explanation: 'People who raise concerns in good faith must not be retaliated against.',
        marks: 1,
      },
      {
        text: 'You accidentally send sensitive information to the wrong recipient. What should you do?',
        type: 'single_choice',
        options: [
          { text: 'Report the incident promptly using the appropriate internal process', isCorrect: true },
          { text: 'Delete your sent message and take no further action', isCorrect: false },
          { text: 'Wait to see whether anyone notices', isCorrect: false },
        ],
        explanation: 'Prompt reporting helps the organization limit the impact of information incidents.',
        marks: 1,
      },
      {
        text: 'A business record contains an error that makes your team look better. What should you do?',
        type: 'single_choice',
        options: [
          { text: 'Correct the record and follow the normal reporting process', isCorrect: true },
          { text: 'Leave it unchanged because it benefits the team', isCorrect: false },
          { text: 'Delete the record', isCorrect: false },
        ],
        explanation: 'Business records should be accurate, complete, and handled transparently.',
        marks: 1,
      },
      {
        text: 'A coworker asks you to share your account password so they can finish a task. What should you do?',
        type: 'single_choice',
        options: [
          { text: 'Share it if the coworker is trusted', isCorrect: false },
          { text: 'Do not share it; use the approved access request process', isCorrect: true },
          { text: 'Write it on a note for the team', isCorrect: false },
        ],
        explanation: 'Credentials are personal and must not be shared.',
        marks: 1,
      },
      {
        text: 'You are unsure whether a planned action complies with the Code of Conduct. What should you do?',
        type: 'single_choice',
        options: [
          { text: 'Proceed and ask for guidance only if a problem occurs', isCorrect: false },
          { text: 'Pause and seek guidance from an appropriate manager or company channel', isCorrect: true },
          { text: 'Ask an external social media group to decide', isCorrect: false },
        ],
        explanation: 'When in doubt, pause and seek guidance through an appropriate company channel.',
        marks: 1,
      },
    ],
  });

  await Assignment.create({
    employeeId: employee._id,
    courseId: course._id,
    courseVersion: course.version,
    cycle: 'none',
    source: 'manual',
    assignedBy: admin._id,
    dueDate: new Date(Date.now() + 14 * 86400000),
    status: 'not_started',
    progressPercent: 0,
  });

  return { employee, course };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to wipe application data when NODE_ENV=production'
    );
  }

  await connectDB();

  if (!/nexora/i.test(mongoose.connection.name)) {
    throw new Error(
      `Refusing to seed database "${mongoose.connection.name}"; set MONGODB_URI to a Nexora demo database name`
    );
  }

  await wipeApplicationData();

  for (const [name, code] of domainSpecs) {
    domains.push(
      await Domain.create({
        name,
        description: `Nexora Industries ${name} learning domain. Code: ${code}.`,
        isCommon: code === 'COMMON',
        isActive: true,
      })
    );
  }

  const admin = await User.create({
    name: randomName(),
    email: 'admin@nexora.example',
    passwordHash: await passwordHash(adminPassword),
    role: 'admin',
    status: 'active',
    forcePasswordChange: false,
  });

  await createUsers(admin);
  const { employee, course } = await createCodeOfConductAssignment(admin);

  console.log('Nexora Industries demo database seeded.');
  console.log(`Admin login: admin@nexora.example / ${adminPassword}`);
  console.log(`Trainer and employee demo password: ${employeePassword}`);
  console.log(
    `Created Code of Conduct course ${course.courseCode} and assigned its quiz only to ${employee.email}.`
  );
  console.log(
    `Created ${domains.length} domains and ${trainers.length} trainers plus ${managers.length + employees.length} employee accounts (${managers.length} managers).`
  );
}

run()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
