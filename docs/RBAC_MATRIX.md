# RBAC matrix

Generated from `src/routes/*.js` by `npm run rbac:matrix`. `A` admin, `T` trainer, `E` employee, `M` manager, `P` public.

| Method | Path | Roles | Protected |
|---|---|---|:---:|
| POST | /auth/login | PUBLIC | no |
| POST | /auth/refresh | PUBLIC | no |
| POST | /auth/logout | ADMIN, TRAINER, EMPLOYEE | yes |
| POST | /auth/logout-all | ADMIN, TRAINER, EMPLOYEE | yes |
| GET | /auth/me | ADMIN, TRAINER, EMPLOYEE | yes |
| POST | /auth/change-password | ADMIN, TRAINER, EMPLOYEE | yes |
| POST | /auth/forgot-password | PUBLIC | no |
| POST | /auth/reset-password | PUBLIC | no |
| GET | /users | ADMIN, MANAGER | yes |
| POST | /users | ADMIN | yes |
| GET | /users/:id | ADMIN, MANAGER, EMPLOYEE | yes |
| PATCH | /users/:id | ADMIN, EMPLOYEE | yes |
| PATCH | /users/:id/status | ADMIN | yes |
| DELETE | /users/:id | ADMIN | yes |
| GET | /domains | ADMIN, TRAINER, EMPLOYEE | yes |
| GET | /domains/:id | ADMIN, TRAINER, EMPLOYEE | yes |
| POST | /domains | ADMIN | yes |
| PATCH | /domains/:id | ADMIN | yes |
| DELETE | /domains/:id | ADMIN | yes |
| GET | /assignments | ADMIN, MANAGER | yes |
| GET | /certificates | ADMIN, MANAGER, TRAINER (own courses) | yes |
| GET | /rules | ADMIN, TRAINER | yes |
| POST | /assignments | ADMIN, MANAGER | yes |
| GET | /assignments/me | EMPLOYEE | yes |
| GET | /assignments/:id | ADMIN, MANAGER, EMPLOYEE | yes |
| POST | /rules | ADMIN | yes |
| GET | /health | PUBLIC | no |
| GET | /health/ready | PUBLIC | no |
| POST | /users/import | ADMIN | yes |
| GET | /users/:id/compliance | ADMIN, MANAGER, EMPLOYEE | yes |
| GET | /domains/:id/stats | ADMIN, TRAINER | yes |
| PUT | /domains/:id/trainers | ADMIN | yes |
| POST | /modules/validate-youtube | ADMIN, TRAINER | yes |
| GET | /courses | ADMIN, TRAINER, EMPLOYEE | yes |
| GET | /courses/:id | ADMIN, TRAINER, EMPLOYEE | yes |
| POST | /courses | ADMIN, TRAINER | yes |
| PATCH | /courses/:id | ADMIN, TRAINER | yes |
| POST | /courses/:id/submit | TRAINER | yes |
| POST | /courses/:id/approve | ADMIN | yes |
| POST | /courses/:id/reject | ADMIN | yes |
| POST | /courses/:id/archive | ADMIN, TRAINER | yes |
| POST | /courses/:id/new-version | TRAINER, ADMIN | yes |
| DELETE | /courses/:id | ADMIN | yes |
| POST | /courses/:id/modules | ADMIN, TRAINER | yes |
| PATCH | /courses/:id/modules/reorder | ADMIN, TRAINER | yes |
| PATCH | /courses/:id/modules/:moduleId | ADMIN, TRAINER | yes |
| DELETE | /courses/:id/modules/:moduleId | ADMIN, TRAINER | yes |
| PUT | /courses/:id/assessment | ADMIN, TRAINER | yes |
| GET | /courses/:id/assessment | ADMIN, TRAINER | yes |
| POST | /courses/:id/uploads | ADMIN, TRAINER | yes |
| GET | /uploads/:id | ADMIN, TRAINER, EMPLOYEE | yes |
| POST | /rules/run | ADMIN | yes |
| POST | /rules/:id/preview | ADMIN | yes |
| PATCH | /rules/:id | ADMIN | yes |
| DELETE | /rules/:id | ADMIN | yes |
| PATCH | /assignments/:id | ADMIN, MANAGER | yes |
| PUT | /assignments/:id/modules/:moduleId/progress | EMPLOYEE | yes |
| POST | /assignments/:id/modules/:moduleId/complete | EMPLOYEE | yes |
| POST | /assignments/:id/attempts | EMPLOYEE | yes |
| GET | /assignments/:id/attempts | ADMIN, TRAINER, EMPLOYEE | yes |
| POST | /attempts/:id/submit | EMPLOYEE | yes |
| POST | /admin/repair/certificates | ADMIN | yes |
| GET | /certificates/me | EMPLOYEE | yes |
| GET | /certificates/expiring | ADMIN, MANAGER, TRAINER (own courses) | yes |
| POST | /certificates | ADMIN, EMPLOYEE | yes |
| PATCH | /certificates/:id/verify | ADMIN, TRAINER | yes |
| PATCH | /certificates/:id/revoke | ADMIN | yes |
| GET | /certificates/verify/:certificateNumber | PUBLIC | no |
| GET | /certificates/:id/file | ADMIN, MANAGER, TRAINER (own domains), EMPLOYEE (own certificate) | yes |
| GET | /notifications | ADMIN, TRAINER, EMPLOYEE | yes |
| PATCH | /notifications/:id/read | ADMIN, TRAINER, EMPLOYEE | yes |
| PATCH | /notifications/read-all | ADMIN, TRAINER, EMPLOYEE | yes |
| GET | /settings | ADMIN | yes |
| PATCH | /settings | ADMIN | yes |
| POST | /admin/jobs/:jobName/run | ADMIN | yes |
| GET | /reports/compliance | ADMIN, MANAGER, TRAINER | yes |
| GET | /reports/completion | ADMIN, MANAGER, TRAINER | yes |
| GET | /reports/expiry-forecast | ADMIN, MANAGER, TRAINER | yes |
| GET | /reports/overdue | ADMIN, MANAGER, TRAINER | yes |
| GET | /reports/trainer/:courseId | ADMIN, MANAGER, TRAINER | yes |
| GET | /reports/assessment-quality/:courseId | ADMIN, MANAGER, TRAINER | yes |
| GET | /audit-logs | ADMIN | yes |
