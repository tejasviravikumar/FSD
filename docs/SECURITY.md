# Security controls and operational limitations

## Implemented controls

| Area | Controls |
|---|---|
| Authentication | bcrypt cost 12, pinned HS256 JWTs, 15-minute access tokens, hashed rotating refresh tokens, replay revocation, account lockout, single-use password resets and token-version invalidation. |
| CSRF and transport | Exact CORS origin allow-list, Origin/Referer and custom-header checks on cookie-authenticated routes; production requires HTTPS and secure cookies. |
| Authorization | Deny-by-default route role declarations; self, active direct-reportee and trainer-owned-course scope checks; private authorized course and certificate file downloads. |
| Validation | Zod schemas on API inputs, ObjectId checks, strict write allow-lists, bounded pagination, body and upload sizes, Mongo query sanitization and sanitized response serialization. |
| Learning workflows | Published-course rule targets, unique assignment and certificate indexes, status-guarded transitions, monotonic/throttled video progress, server-side assessment grading, guarded certificate issue/repair. |
| Reports | Admin-wide reports; manager direct-reportee and trainer course scopes; CSV cells neutralize formula-leading `=`, `+`, `-`, and `@` values. |
| Uploads | PDF/JPG/PNG extension, MIME and magic checks, 5 MB limit, random storage names outside the static path, authorized downloads and upload rate limiting. `scanUploadedBuffer` is an adapter hook. |
| Jobs | Settings-driven expiry and reminder thresholds, idempotency records, atomic retry cap of three delivery attempts, owner-scoped notifications, Admin-only manual job triggers and audit events. |
| Abuse protection | Helmet, request rate limits, auth-specific throttles, upload and public certificate-verification limits, throttled progress writes. |

## Operational limitations

- MongoDB transactions and replica sets are not used. Work spanning multiple documents relies on unique indexes and guarded/idempotent operations; a multi-document workflow is not transactionally atomic.
- Cron runs in each API process. Run one scheduler-enabled instance unless a distributed leader lock is added.
- Rate-limit state is in memory and is not shared across instances.
- Reminder and event email depends on console or SMTP delivery. Failed reminder delivery can retry on later scheduled/manual runs up to three attempts.
- YouTube availability checks need `YOUTUBE_API_KEY`; without it, the application can parse URLs but cannot verify current availability or embeddability.
- Uploaded files are stored on local disk. The app has no bundled malware scanner, remote object storage, or cross-host file sharing.
- The seed command intentionally removes application documents and files referenced by upload records in the configured database/storage directory before recreating demo content. It refuses production mode and database names that do not contain “Nexora”; it is not a production migration tool.
- MFA and domain-head course approval are not implemented. Admins approve courses.
- The repository includes earlier Jest/Supertest tests, but Phase 5 report and seed behavior has no new automated test coverage. Tests were not run during this implementation request.

## Production operations

Use TLS, MongoDB authentication/TLS, least-privilege database credentials, backups, a strong unique signing secret, exact CORS origins, SMTP mode, and private upload storage. Give the seed command a dedicated non-production database. Keep audit logs append-only operationally and define retention and alerting. Regenerate route inventory with `npm run rbac:matrix` when route declarations change.

The route inventory is [RBAC_MATRIX.md](RBAC_MATRIX.md) and the API contract is [openapi.yaml](openapi.yaml).
