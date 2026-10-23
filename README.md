# Nexora Training and Certification API

Node.js 22.12+, Express 4, MongoDB, and Mongoose backend for employee learning and certification, with the React/Vite frontend in `frontend/`. The service provides authentication, role-based access, course authoring, assignments, progress and assessments, certificates, compliance, notifications, scheduled jobs, reports, and audit logs.

## Setup

1. Install Node.js 22.12+ and have a MongoDB database available.
2. Create the project-root `.env` from `.env.example` (`Copy-Item .env.example .env` in PowerShell). Set `MONGODB_URI` to a running MongoDB instance and set `JWT_SECRET` to a random value of at least 32 characters. Keep `.env` private; it is ignored by Git. The example URI expects MongoDB on this computer at `127.0.0.1:27017`.
3. Run `npm ci`.
4. For an empty demo database, run `npm run seed`. This deletes application documents and uploaded files in the configured database and repopulates demo data. The seed script refuses `NODE_ENV=production` and database names without “Nexora”. Back up any data you need first.
5. Run `npm run dev` during development or `npm start` to start the API normally.

In a second terminal, run `npm ci --prefix frontend` once, then `npm run client:dev` from the repository root. The React app runs at `http://localhost:5173`; copy `frontend/.env.example` to `frontend/.env` to change `VITE_API_URL`.

The demo admin login defaults to `admin@nexora.example` / `NexoraDemo!2026`. Set `SEED_ADMIN_PASSWORD` before seeding to choose another admin password. Trainer and employee demo accounts use `TrainingDemo!2026` by default; set `SEED_EMPLOYEE_PASSWORD` to change it. Trainer and employee demo users require a password change at first login; the demo admin can sign in directly.

See [docs/DEMO_ACCESS.md](docs/DEMO_ACCESS.md) for the complete demo account list and seeded data details. Trainer accounts are each assigned to one domain: `trainer01` is Software / IT, while Manufacturing is assigned to `trainer03` and `trainer04`. A trainer can create courses only in their assigned domain(s); choosing another domain returns **Forbidden**. An admin can update a trainer's assigned domains from People before the trainer creates a course.

API base URL is `http://localhost:4000/api/v1`. Swagger UI is served at `/api/docs`; the OpenAPI file is `/openapi.yaml`. Liveness and database readiness endpoints are `/api/v1/health` and `/api/v1/health/ready`.

## Environment variables

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development`, `test`, or `production`; defaults to development. |
| `PORT` | HTTP port; defaults to 4000. |
| `MONGODB_URI` | MongoDB connection string, including the database name. |
| `JWT_SECRET` | Signing secret, minimum 32 characters; production rejects common placeholders. |
| `JWT_ISSUER`, `JWT_AUDIENCE` | JWT validation values; have application defaults. |
| `CORS_ORIGINS` | Comma-separated exact browser origins; defaults to `http://localhost:5173`. |
| `COOKIE_SECURE` | `true` or `false`; production requires `true`. |
| `TIMEZONE` | Cron schedule timezone; defaults to `Asia/Kolkata`. |
| `UPLOAD_DIR` | Private local upload storage; defaults to `./private_uploads`. |
| `RESET_URL_BASE` | Frontend password reset URL base. |
| `MAILER_TRANSPORT` | `console` or `smtp`; production requires `smtp`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | SMTP connection and sender configuration. Required for SMTP; port defaults to 587. |
| `YOUTUBE_API_KEY` | Optional YouTube Data API key for availability and embeddability checks. |
| `SEED_ADMIN_PASSWORD` | Optional admin password printed after seeding. |
| `SEED_EMPLOYEE_PASSWORD` | Optional common password for seeded trainers and employees. |

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | Start the API without watch mode. |
| `npm run dev` | Start with Node watch mode. |
| `npm run seed` | Destructively reset app data in the configured non-production Nexora database and seed the demo. |
| `npm run repair:demo-resources` | Replace seeded placeholder YouTube modules with verified videos without wiping the database. |
| `npm run videos:verify` | Search and verify the configured course videos with `YOUTUBE_API_KEY`; writes the dataset and verification list under `docs/`. |
| `npm run client:dev` | Start the React app from `frontend/` with Vite. |
| `npm run client:build` | Build the React app in `frontend/dist`. |
| `npm run client:preview` | Preview the frontend production build. |
| `npm run rbac:matrix` | Regenerate `docs/RBAC_MATRIX.md` from registered routes. |
| `npm run lint` | Run ESLint over the repository. |
| `npm test` | Run the existing Jest/Supertest suites. |
| `npm run test:coverage` | Run those suites with coverage output. |

Existing test files cover earlier authentication, course, learning and YouTube behavior. The Phase 5 work was not tested here; no tests were added or run for this request.

## Folder structure

- `src/config`: environment validation, MongoDB connection, logging and mailer provider.
- `src/middlewares`: authentication/RBAC, CSRF, request validation, uploads and error handling.
- `src/models`: Mongoose schemas and indexes.
- `src/routes`: auth, user/domain, course, learning and operations API routes.
- `src/services`: authentication, resources, course workflows, learning, uploads and scheduled jobs.
- `src/utils`: YouTube URL parsing, async route handling and application errors.
- `scripts`: seed and RBAC inventory scripts.
- `docs`: OpenAPI spec, generated RBAC matrix and security notes.
- `tests`: existing Jest and Supertest suites; no new test files were created.
- `private_uploads`: local private upload storage; excluded from static web serving.

## Scheduled jobs

Jobs start with the API and run in `TIMEZONE`:

- Nightly at 01:15: recompute certificate and overdue assignment statuses, then evaluate employee assignment rules and renewal windows.
- Daily at 09:00: send due/expiry threshold reminders and weekly overdue reminders; managers receive escalation within 30 days of due date, domain heads after more than 14 days overdue.
- Mondays at 08:00: check published YouTube modules for availability and embeddability.

Admins can run handlers immediately with `POST /api/v1/admin/jobs/nightly/run`, `/reminders/run`, and `/youtube/run`. Persisted reminder keys prevent duplicate notification/email delivery for the same target and threshold. Failed delivery is retried up to three attempts. Email uses the console mailer in development or Nodemailer SMTP when selected.

## API and security

All API routes are listed in [docs/openapi.yaml](docs/openapi.yaml); access classes are listed in [docs/RBAC_MATRIX.md](docs/RBAC_MATRIX.md). JSON responses use `{ success, data, message, meta }`; report endpoints accept `?format=csv` and neutralize spreadsheet formula prefixes. RBAC denies access by default, scopes managers to active direct reportees and trainers to their own courses, and uses Zod input validation, ObjectId checks, whitelisted writes and audit records for sensitive actions.

See [docs/SECURITY.md](docs/SECURITY.md) for controls and operational limitations.

To add or refresh randomized compliance demo data without clearing the database, run `npm run seed:compliance` after the demo users and domains exist.
