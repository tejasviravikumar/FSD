# Demo course resources

The seeded courses include verified public, embeddable YouTube lessons plus a built-in reading module. The [verification list](COURSE_VIDEO_VERIFICATION.md) records each video title, channel, URL and API verification result. The [course video dataset](course-video-dataset.txt) also carries the proposed audience, due date and recurrence notes from the supplied course list.

| Course | Included resource |
| --- | --- |
| Workplace Safety | Shift hazard checks, protective equipment, incident response and reporting. |
| Information Security | Account protection, phishing awareness, approved storage and access control. |
| Code of Conduct | Respectful conduct, conflicts of interest, confidentiality and reporting. |
| Privacy Essentials | Purpose limitation, minimum necessary data, sharing, retention and breach reporting. |
| Incident Response | Prioritization, escalation, evidence preservation and incident timelines. |
| Secure Development | Supported dependencies, input validation, authorization, secrets and vulnerability reporting. |
| Quality Management | Approved procedures, traceability, defect handling and corrective actions. |
| Customer Care | Listening, identity checks, accurate records and escalation. |
| Operational Excellence | Process mapping, evidence-based improvement and outcome tracking. |
| Data Handling | Classification, approved storage, access checks, retention and disposal. |
| Leadership Basics | Clear outcomes, feedback, fair decisions and employee development. |
| Business Continuity | Recovery priorities, approved contacts, continuity materials and exercise follow-up. |
| Financial Controls | Purchasing routes, supporting records, separation of duties and payment-change checks. |
| Inclusive Workplace | Fair decisions, respectful communication, participation and reporting. |
| Environmental Awareness | Site practices for energy, water, waste, hazardous materials and incident reporting. |

The supplied assignment descriptions are planning notes. In this app, assignment rules apply to courses, not individual modules. Before creating rules, map the proposed audiences and conditions to the actual Nexora domains, employee levels, tags and locations in your database.

## Apply resources to an existing demo database

Older seeded records contain placeholder YouTube IDs and will continue to show unavailable videos until updated. From the project folder, run:

```powershell
npm run repair:demo-resources
```

This replaces placeholder modules with the verified video lessons and keeps a built-in reading module. It updates only matching demo courses; it does not wipe or reseed records. The command refuses to run when `NODE_ENV=production` or when the database name does not include `Nexora`. Refresh the course player after it finishes.

New demo databases seeded with `npm run seed` use these video links and readings.
