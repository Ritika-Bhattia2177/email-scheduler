# Assignment Requirement Mapping

Statuses describe repository support, not runtime verification. The automated/runtime verification work is tracked separately in [TESTING.md](TESTING.md).

## Backend requirements

| Requirement | Status | Implementation / note |
|---|---|---|
| TypeScript and Express API | Implemented; runtime verification pending | `backend/src/app.ts`, route/controller/service modules |
| PostgreSQL and Prisma persistence | Implemented; runtime verification pending | `User`, `SenderAccount`, `EmailJob`, `EmailRecipient`, `EmailAttachment`, `EmailEvent`, and `SlackConnection` models |
| Redis and BullMQ queue | Implemented; runtime verification pending | One queue named `email-scheduler`, shared Redis connection, delayed job IDs derived from email-job UUIDs |
| Configurable worker concurrency | Implemented | `WORKER_CONCURRENCY`, default `5` |
| Delayed scheduling and cancellation | Implemented; runtime verification pending | BullMQ delay; scheduled-only cancellation updates DB state/event and removes a non-active queue job when possible |
| Minimum inter-email delay | Implemented in code; timing verification pending | Global coordination, default `EMAIL_DELAY_MS`, optional per-job `minimumDelayMs` |
| Global hourly limit | Implemented in code; quota verification pending | Rolling 60-minute global counter, `MAX_EMAILS_PER_HOUR` |
| Per-sender hourly limit | Implemented in code; quota verification pending | Separate sender counter keyed by `senderAccountId`; per-job limit can tighten but not exceed the environment cap |
| Atomic rate-limit reservation and rescheduling | Implemented in code; concurrency/load verification pending | Redis Lua scripts reserve capacity; a blocked job keeps its identity/status and is moved to delayed execution |
| Idempotent scheduling | Implemented in code; concurrent retry verification pending | Globally unique PostgreSQL `EmailJob.idempotencyKey`; same user's existing eligible request is returned |
| SMTP / Ethereal | Implemented in code; delivery verification pending | Nodemailer with configured transport or temporary Ethereal account in development |
| Elasticsearch indexing/search | Implemented in code; service verification pending | Owner-filtered search, status/date/sender filters, pagination, optional reindex utility |
| Slack OAuth and rate-limit notification code | Present in backend; real OAuth/notification verification pending | `chat:write`; encrypted token storage; global/sender rate-limit notifications; notification failure is isolated |
| Bull Board queue dashboard | Implemented in code; access verification pending | `/admin/queues`, read-only adapter, Basic Auth, sanitized job data |
| Local file attachments | Implemented in code; upload/SMTP verification pending | Validated disk storage, metadata in PostgreSQL, Nodemailer attachment support |
| Google sign-in | Implemented; real browser verification pending | Login starts the backend OpenID Connect authorization-code flow; the backend issues an HttpOnly application session after validating Google's identity. |

## Frontend requirements

| Requirement | Status | Implementation / note |
|---|---|---|
| React and TypeScript dashboard | Implemented; browser verification pending | Existing compact dashboard layout and responsive CSS |
| Scheduled and sent mailboxes | Implemented in code | Live `GET /api/emails` results, bounded page requests, pagination, refresh, loading/error/empty states |
| Compose and sender selection | Implemented in code | Live `GET /api/senders`; API sender identity does not expose SMTP credentials |
| Multiple recipients and recipient-list upload | Implemented in code | Address entry and CSV/TXT parsing, normalization and duplicate prevention |
| Scheduling controls | Implemented in code | Local date/time converted to ISO; `minimumDelayMs` and per-job sender `hourlyLimit` sent with the request |
| Attachment selection | Implemented in code | Multiple files, UI validation and multipart submission with email; runtime validation pending |
| Search and filters | Implemented in code | Elasticsearch search endpoint, query state, status selector, pagination, error/no-result states |
| Email detail and event history | Implemented in code | Owner-scoped detail API; attachment metadata and persisted events are displayed |
| Cancellation and retry | Implemented in code | Scheduled-only cancellation and failed-job retry use backend endpoints |
| Real Google sign-in | Implemented; browser test required | Configure backend Google OAuth credentials and the session signing secret before testing. |

## Known limitations

- Google OAuth is implemented but has not been verified with a real browser login.
- Real Slack authorization and channel delivery have not been verified as part of the pending runtime test phase.
- 1000+ job throughput, simultaneous workers, rate-limit timing, and rate-limit rescheduling have not been load-tested.
- Redis/PostgreSQL persistence across a process/service restart has not been verified in the current test phase. Redis server persistence settings are external to the application configuration.
- Full browser-to-API-to-queue-to-SMTP and attachment delivery have not been verified end-to-end.
- Attachments are stored on the local backend filesystem; there is no public attachment download/list API or distributed file storage layer.
- Sender CRUD routes exist, but the frontend provides sender selection rather than a sender-management/settings page.
- Local development authentication requires an existing user UUID; this checkout does not include a seed script or a frontend flow for creating a development user.
- CC and BCC are not supported by the current backend and are rejected on email creation.
- No dedicated automated test runner/script is configured in the backend or frontend package manifests.
- If SMTP accepts a message and Redis then fails to commit the reservation, the worker avoids resending to prevent duplicate delivery; the Redis quota counter may not reflect that accepted message.
- This checkout contains no Prisma migration files; local schema setup uses `prisma db push`.
