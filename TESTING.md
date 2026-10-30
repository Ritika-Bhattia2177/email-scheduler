# Testing and Verification Plan

This file is a plan, not a test report. All runtime, service-integration, and scale checks below are **pending verification** unless marked otherwise. Neither package manifest defines a `test` script or a dedicated test framework. Backend `queue:test` is a queue-only utility (it creates a test user/sender/email row and a delayed job; it does not send email), not a test suite.

## Current checks

| Check | Status |
|---|---|
| Backend production build (`cd backend && npm run build`) | Build command is available; run against the checkout before release |
| Frontend production build (`cd frontend && npm run build`) | Build command is available; run against the checkout before release |
| Prisma schema/client | `npm run prisma:generate`; schema sync for this checkout uses `npx prisma db push` because no migration files are present |
| Runtime/integration checks | Pending |
| 1000+ email load check | Pending; explicitly not run yet |

Do not treat HTTP success alone as proof of SMTP delivery. For local delivery, inspect the Ethereal test inbox using the test account created by Nodemailer; the backend deliberately does not log the preview URL or expose credentials through an API.

## Prerequisites for manual checks

1. Start PostgreSQL, Redis, and Elasticsearch with a valid local configuration.
2. Start the backend with `AUTH_MODE=development`; start Vite with `VITE_DEV_USER_ID` set to an existing user UUID.
3. Ensure at least one sender belongs to that user (`GET /api/senders`).
4. For actual delivery, configure local Ethereal behavior (no SMTP credentials) or a controlled SMTP test account. Never use a production recipient/account for test messages.
5. For search, ensure Elasticsearch is reachable and its configured CA is readable. For Slack checks, first connect a test workspace and configure the notification channel.

Use `DEV_USER_ID`, `SENDER_ID`, and returned email job IDs as shell variables/placeholders; do not store credentials in commands or commit local env files. API routes and payloads are documented in [API.md](API.md).

## Manual verification cases

| Case | Procedure | Expected observation | Status |
|---|---|---|---|
| Health | `curl -i http://localhost:5000/api/health` | `200`, safe success JSON; no credentials or dependency internals | Pending |
| Sender ownership | `GET /api/senders` with the dev header; try a sender UUID belonging to a different user on email creation | Only owned senders are returned; scheduling with another user's sender is rejected | Pending |
| Schedule a future email | `POST /api/emails` with a future ISO timestamp, one recipient, sender UUID and idempotency header | `201`, `SCHEDULED` record, `SCHEDULED` event and delayed queue entry | Pending |
| Delayed execution | Schedule safely in the future and inspect `/admin/queues` | Job appears as delayed and becomes eligible at the scheduled time | Pending |
| Delivery | Schedule one controlled message in the near future | SMTP/Ethereal accepts it; job becomes `SENT`, `sentAt` and `SENT` event are persisted | Pending |
| Idempotency | Repeat the same request and same `Idempotency-Key` for the same user | Existing job is returned; no second `EmailJob` or queue ID is created | Pending |
| Minimum delay | Set a small controlled delay and schedule three messages; inspect SENT timestamps and rate-limit/reschedule events | Successful sends are separated by the configured minimum; delayed jobs remain scheduled | Pending |
| Global hourly limit | In a disposable environment set a low `MAX_EMAILS_PER_HOUR`, schedule more jobs than the cap | Successful sends stay within the rolling quota; blocked jobs get RATE_LIMITED/RESCHEDULED and are later delayed, not failed | Pending |
| Per-sender hourly limit | Set a low sender cap and send over the limit from one sender, then test a different sender | Sender quotas coordinate independently while the global quota still applies | Pending |
| Redis coordination | Run two backend worker instances against the same Redis and test low quotas | No duplicate reservation or quota overrun; inspect Redis sorted-set state and DB events | Pending |
| Slack notification | Connect a test workspace, then trigger one controlled global or sender quota block | Slack receives a rate-limit notice in the configured channel; notification failure must not cancel/resend the email | Pending |
| Search | `GET /api/emails/search?q=<term>&status=SENT&page=1&limit=20` | Elasticsearch results are paginated and limited to the requesting user/current PostgreSQL records | Pending |
| Attachment upload/send | Submit an allowed small file with `attachments`; then inspect email detail and Ethereal message | Metadata is returned without server paths; attachment is associated and delivered; invalid/oversized files are rejected | Pending |
| Cancellation | Cancel a future scheduled job, then let its original due time pass | Job becomes `CANCELLED` with event; worker does not send it | Pending |
| Failed-job retry | Cause a controlled retryable SMTP failure, wait for final failure, then call `POST /api/emails/:id/retry` | Existing email job returns to scheduled processing; no duplicate EmailJob record | Pending |
| Bull Board | Open `/admin/queues` without credentials and then with configured Basic Auth | Unauthenticated access is denied; authorized UI lists queue states and is read-only | Pending |
| 1000+ jobs | In an isolated test environment enqueue 1000+ future jobs around one time and monitor process/Redis memory | Jobs are persisted as delayed queue work without per-job application timers or bulk in-memory loading | Pending; not run |
| Restart persistence | Enqueue future jobs, restart backend and Redis according to the intended persistence setup, then inspect queue/database | PostgreSQL records and Redis/BullMQ delayed jobs recover consistently | Pending; not run |
| Frontend flow | In a browser sign in using configured local development identity, compose/schedule, search, open detail, cancel a future job | UI uses live APIs and handles loading, empty, errors, pagination and status transitions | Pending |

## Safe rate-limit test notes

Use a disposable local database/Redis and a low test quota (for example a global cap of `2`) before scheduling only three harmless recipients. Environment changes require restarting the backend. `EmailJob.hourlyLimit` can lower the sender cap for a particular email; it cannot raise `MAX_EMAILS_PER_SENDER_PER_HOUR`, and it does not override the global cap. Avoid creating hundreds of messages just to demonstrate a blocked/rescheduled job.

Rate limits count email jobs submitted to SMTP, not recipient count. Slack notifications are sent only for global or sender hourly quota blocks; minimum-delay-only rescheduling does not notify Slack. The Slack service applies notification cooldowns.

## Runtime test evidence to record later

When running these checks, record the date/environment, relevant request IDs, returned job IDs/statuses, matching `EmailEvent` records, observed queue state, and sanitized SMTP/Slack/search outcomes. Never paste `.env` values, SMTP or Slack tokens, full credentials, encryption keys, session cookies, or Ethereal preview links into a report.
