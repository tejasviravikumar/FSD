# Nexora demo access

These credentials and accounts are for the local demo database created by `npm run seed`. They are not production credentials.

## Sign in

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@nexora.example` | `NexoraDemo!2026` |
| Trainer | `trainer01@nexora.example` through `trainer14@nexora.example` | `TrainingDemo!2026` |
| Manager | `department.manager01@nexora.example` through `department.manager04@nexora.example` | `TrainingDemo!2026` |
| Employee | Email format is `{designation-slug}{employee-number}@nexora.example`; examples: `software.engineering01@nexora.example`, `it.support02@nexora.example`, `manufacturing.operations03@nexora.example` | `TrainingDemo!2026` |

All demo accounts can sign in without a forced password-change prompt. The seed script prints the credentials it used; `SEED_ADMIN_PASSWORD` and `SEED_EMPLOYEE_PASSWORD` override the defaults.

For an existing seeded database, run `npm run rename:demo-employee-emails` once to rename legacy `employeeNN` and `managerNN` addresses using each account's designation. This changes the sign-in email while keeping passwords and account records unchanged. New seed runs already use designation-based addresses.

Designation email groups use employee numbers `01, 10, 19, 28` for `software.engineering`; `02, 11, 20, 29` for `it.support`; `03, 12, 21, 30` for `manufacturing.operations`; `04, 13, 22, 31` for `quality.assurance`; `05, 14, 23, 32` for `financial.planning`; `06, 15, 24, 33` for `people.operations`; `07, 16, 25, 34` for `sales`; `08, 17, 26, 35` for `marketing`; and `09, 18, 27, 36` for `logistics`.

## Seeded data

- 7 domains: Software / IT, Manufacturing, Finance, HR, Sales & Marketing, Logistics, and Common.
- 2 trainers per domain.
- 15 published courses, each assigned one trainer as its owner. Courses display a short code such as `NX-A4K82P9Q`; MongoDB ObjectIds remain internal.
- 7 active assignment rules, one per domain.
- 40 manager and employee accounts, with manager relationships, and 40 assignments across several statuses.
- Certificates in valid, expiring, expired, and pending-verification states.
- Seeded courses include public YouTube lessons verified as embeddable, plus built-in reading modules.
- To repair an existing seeded database without wiping it, run `npm run repair:demo-resources` with its Nexora database configured in `.env`.
- See [Course resources](COURSE_RESOURCES.md) for video verification results, topics and database repair steps.

### Trainer domain access

Each seeded trainer is assigned to exactly one domain. The trainer email numbers map to domains in pairs, in this order:

| Trainer accounts | Assigned domain |
| --- | --- |
| `trainer01`–`trainer02` | Software / IT |
| `trainer03`–`trainer04` | Manufacturing |
| `trainer05`–`trainer06` | Finance |
| `trainer07`–`trainer08` | HR |
| `trainer09`–`trainer10` | Sales & Marketing |
| `trainer11`–`trainer12` | Logistics |
| `trainer13`–`trainer14` | Common |

All use the trainer password listed above. For example, `trainer01@nexora.example` cannot create a Manufacturing course and receives **Forbidden**; use `trainer03@nexora.example` or `trainer04@nexora.example`, or have an admin assign Manufacturing to Trainer 1 in People. The course form currently shows domains beyond a trainer's access, so the error appears only after saving.

The default demo database name is `nexora_demo`. `npm run seed` deletes existing application records in the configured database before reseeding; use an empty demo database if you need to preserve data.

## Role views

- **Admin:** Overview, People, Domains, Courses, Assignment rules, Approvals, Reports, Audit log, and Settings.
- **Trainer:** Overview, My courses, Analytics, and Notifications.
- **Employee:** My learning, My certificates, and Notifications.
- **Manager:** An employee account with additional My team and Team reports views.
