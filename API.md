# API Reference

Base URL for local development: `http://localhost:5000/api`.

Responses use `{ "success": true, "data": ... }` for data-bearing success responses and `{ "success": false, "message": "..." }` for errors. Some successful routes also include a `message` or pagination fields. Do not assume a nested `error` object or error code is returned.

## Authentication

In local development, protected routes require `x-user-id: <existing-user-UUID>` when `AUTH_MODE=development`. The frontend adds this header from `VITE_DEV_USER_ID` only in Vite development mode. In production, requests use the signed HTTP-only session cookie; `x-user-id` is rejected.

The Slack OAuth callback is state-bound to the application user and does not require an additional user header. Google sign-in uses a Redis-backed state/nonce and a signed HttpOnly application session; browser verification is pending.

## Health

| Method and URL | Purpose | Auth | Success |
|---|---|---|---|
| `GET /api/health` | Confirms the API process is responding; it does not check optional infrastructure | None | `200 { success: true, message }` |

## Email jobs

### `POST /api/emails`

Uses `multipart/form-data`; attachment input name is repeated `attachments`. `deliveryMode=send` submits synchronously through SMTP and persists `PROCESSING` before the attempt, then `SENT` only after SMTP acceptance. `deliveryMode=schedule` requires a future `scheduledAt`, persists `SCHEDULED`, and enqueues a BullMQ job. Omitting `deliveryMode` preserves legacy scheduled behavior.

Fields:

| Field | Format | Notes |
|---|---|---|
| `deliveryMode` | `send` or `schedule` | Required by the current frontend; omission means `schedule` for older API clients |
| `senderAccountId` | UUID string | Must belong to the authenticated user |
| `recipientEmails` | JSON-encoded array of email strings | At least one valid address; duplicates are normalized |
| `subject` | string | Required; up to 998 characters |
| `bodyHtml` | string | Required; up to 900,000 UTF-8 bytes |
| `scheduledAt` | ISO date-time with timezone | Required for `schedule`; immediate sends use the server's current UTC time |
| `minimumDelayMs` | positive integer string | Optional; defaults to `EMAIL_DELAY_MS`, maximum 24 hours |
| `hourlyLimit` | positive integer string | Optional per-job sender limit, defaulting to `MAX_EMAILS_PER_SENDER_PER_HOUR`; maximum 10,000 (effective value is also capped by the environment sender maximum) |
| `attachments` | file(s) | Optional; limits and accepted types are described in [ARCHITECTURE.md](ARCHITECTURE.md#attachments) |

Send `Idempotency-Key: <client-generated-key>` for retries of the same logical request. Successful sends and scheduled requests return `201`; SMTP failure persists `FAILED` and returns an error. A duplicate successful/in-progress request with the same key and user returns the existing record with `200` without delivering again. A key belonging to another user, or a key whose job is failed/cancelled, returns `409`.

Example (the file argument is optional):

```sh
curl -X POST 'http://localhost:5000/api/emails' \\
  -H "x-user-id: $DEV_USER_ID" \\
  -H 'Idempotency-Key: local-compose-attempt-001' \\
  -F 'senderAccountId=<sender-uuid>' \\
  -F 'deliveryMode=schedule' \\
  -F 'recipientEmails=["recipient@example.test"]' \\
  -F 'subject=Scheduled message' \\
  -F 'bodyHtml=<p>Hello</p>' \\
  -F 'scheduledAt=2027-01-15T10:00:00.000Z' \\
  -F 'minimumDelayMs=1000' \\
  -F 'hourlyLimit=50' \\
  -F 'attachments=@./document.pdf'
```

The success `data` contains the email job, sender, recipients, attachment metadata (never the server storage path), and queue information for scheduled requests. `cc`/`bcc` are not supported and are rejected.

### `GET /api/emails`

Returns scheduled, sent, or failed jobs owned by the authenticated user.

| Query | Default | Allowed |
|---|---:|---|
| `status` | `scheduled` | `scheduled`, `sent`, `failed` |
| `page` | `1` | Positive integer |
| `limit` | `100` | Positive integer up to `100` |

Returns `{ success, data: EmailJob[], pagination: { page, limit, total, totalPages } }`. Extremely large offsets are rejected. This endpoint does not return processing/cancelled statuses.

### `GET /api/emails/search`

Searches the Elasticsearch index and returns current, owner-scoped records rechecked against PostgreSQL.

| Query | Description |
|---|---|
| `q` | Optional full-text query, max 500 characters; may be empty for filter-only searches |
| `status` | Optional: `SCHEDULED`, `PROCESSING`, `SENT`, `FAILED`, or `CANCELLED` (case-insensitive) |
| `page`, `limit` | Page defaults to `1`, limit to `20`; maximum limit is `100` |
| `senderAccountId` | Optional UUID; `senderId` is a supported legacy alias |
| `from`, `to` | Optional ISO date-time range for `scheduledAt` |
| `sentFrom`, `sentTo` | Optional ISO date-time range for `sentAt` |

Response: `{ success: true, data: { results, emails, page, limit, total, pagination } }`. `results` and `emails` contain the same result array for compatibility. Search returns `503` when Elasticsearch is unavailable.

### `GET /api/emails/:id`

Returns the owned email job, sender, recipients, attachment metadata, and ordered event history. Attachment `storagePath` is stripped. Invalid UUIDs return `400`; missing or non-owned records return `404`.

### `POST /api/emails/:id/cancel`

Cancels only a currently `SCHEDULED` job owned by the caller and records a `CANCELLED` event. It returns `{ success: true, data: updatedJob }`. A job that cannot be cancelled is reported as not found (`404`).

### `POST /api/emails/:id/retry`

Requeues only an owned `FAILED` job using the same email job ID. Returns the scheduled job and queue information. Non-failed/missing jobs return `404`; queue unavailability returns `503`.

## Senders

Sender records are mailbox identities (`email`, `displayName`), not SMTP credential containers. SMTP transport settings are backend environment configuration. Responses select only sender identity and timestamps; credentials are not part of this model or response.

| Method and URL | Purpose | Body/query | Success |
|---|---|---|---|
| `GET /api/senders` | List caller's senders | None | `200 { success, data: Sender[] }` |
| `GET /api/senders/:id` | Get an owned sender | UUID path | `200 { success, data: Sender }` |
| `POST /api/senders` | Create sender | JSON `{ email, displayName }` | `201 { success, message, data }` |
| `PUT /api/senders/:id` | Update sender | JSON with `email` and/or `displayName` | `200 { success, message, data }` |
| `DELETE /api/senders/:id` | Delete sender | UUID path | `200 { success, message }` |

All sender routes require authentication. Invalid input returns `400`; missing/non-owned senders return `404`; duplicate email or deletion blocked by email history returns `409`.

## Slack

Slack is optional. Configure the backend Slack variables and install/authorize the app in a workspace before testing. The exact OAuth redirect URI is configured by `SLACK_REDIRECT_URI` and must match the Slack app.

| Method and URL | Purpose | Auth | Success |
|---|---|---|---|
| `GET /api/slack/oauth/start` | Begins OAuth and redirects to Slack; stores single-use, expiring state tied to the user | Protected; requires session or development `x-user-id` | `302` redirect |
| `GET /api/slack/oauth/callback?state=…&code=…` | Consumes state, exchanges code, encrypts token, stores connection | State-bound; no separate user header | `200 { success, data: connectionMetadata }` |
| `GET /api/slack/status` | Checks the caller's connection metadata | Protected | `200 { success, data: { connected, … } }` |
| `POST /api/slack/disconnect` | Removes the caller's connection and attempts token revocation | Protected | `200 { success, data: { connected: false } }` |

No endpoint returns the Slack access token. Rate-limit notifications are sent by the worker through the service, not a public notification API. Slack failures are caught and do not fail the email job.

There are no standalone attachment upload, list, or download routes. Uploads are part of `POST /api/emails`; email detail returns metadata only.

## Authentication routes present in backend

Google sign-in routes are implemented. A completed real browser login has not yet been verified.

| Method and URL | Purpose |
|---|---|
| `GET /api/auth/google` | Starts Google OAuth and sets state cookie |
| `GET /api/auth/google/callback` | Validates state/code, completes account/session flow, redirects to frontend |
| `GET /api/auth/me` | Returns the current user `{ id, email, name, avatarUrl }` |
| `POST /api/auth/logout` | Clears the session cookie |

`/api/auth/me` requires a valid session or development identity and returns `401` otherwise.

## Bull Board

When `BULL_BOARD_ENABLED=true`, the read-only queue dashboard is mounted at `GET /admin/queues` and its Bull Board subroutes. It is protected by HTTP Basic Auth using `QUEUE_DASHBOARD_USERNAME` and `QUEUE_DASHBOARD_PASSWORD`. Missing credentials produce `503`; invalid/missing Basic Auth produces `401`. The dashboard is disabled by default when `NODE_ENV=production` unless explicitly enabled.

## Common errors

The centralized API format is `{ success: false, message }`. Common statuses include:

| Status | Meaning |
|---:|---|
| `400` | Invalid body, query, path UUID, or upload |
| `401` | Missing/invalid authentication |
| `404` | Resource not found or not owned by caller |
| `409` | Idempotency/sender conflict or disallowed state transition |
| `413` | Upload too large |
| `503` | Queue, search, or other required service unavailable |
| `500` | Unexpected server error |

## Environment variables

Names below are read by `backend/src/config/env.ts` or Vite. Values are intentionally not included. Defaults are the code defaults; `.env.example` may explicitly provide a local value.

| Variable | Component | Requirement/default | Purpose |
|---|---|---|---|
| `NODE_ENV` | Backend | Optional; `development` | `development`, `test`, or `production` |
| `AUTH_MODE` | Backend | Optional; `production` in code (example sets `development`) | Enables development `x-user-id` only when set to development |
| `PORT` | Backend | Optional; `5000` | HTTP listener port |
| `DATABASE_URL` | Backend | Required | PostgreSQL connection URL |
| `REDIS_URL` | Backend | Optional | Redis connection URL (for Render, use the private/internal URL when available); takes precedence over host settings |
| `REDIS_HOST` | Backend | Optional; `localhost` | Redis host shared by queue/services when `REDIS_URL` is not set |
| `REDIS_PORT` | Backend | Optional; `6379` | Redis port |
| `REDIS_PASSWORD` | Backend | Optional | Redis password |
| `WORKER_CONCURRENCY` | Backend | Optional; `5` | BullMQ worker concurrency |
| `EMAIL_DELAY_MS` | Backend | Optional; `1000` | Default global minimum delay |
| `MAX_EMAILS_PER_HOUR` | Backend | Optional; `100` | Global rolling hourly quota |
| `MAX_EMAILS_PER_SENDER_PER_HOUR` | Backend | Optional; `50` | Maximum sender-specific rolling hourly quota |
| `SMTP_HOST` | Backend | Optional; `smtp.ethereal.email` | Configured SMTP host |
| `SMTP_PORT` | Backend | Optional; `587` | SMTP port |
| `SMTP_SECURE` | Backend | Optional; `false` | SMTP TLS mode |
| `SMTP_USER` | Backend | Required in production; paired with password | SMTP username; if absent in development, Ethereal test credentials are generated |
| `SMTP_PASSWORD` | Backend | Required in production; paired with user | SMTP password |
| `SMTP_FROM` | Backend | Optional | Optional From header override |
| `ELASTICSEARCH_NODE` | Backend | Optional; code `http://localhost:9200`, example HTTPS | Elasticsearch endpoint |
| `ELASTICSEARCH_INDEX` | Backend | Optional; `emails` | Search index name |
| `ELASTICSEARCH_CA_CERT_PATH` | Backend | Optional; `./http_ca.crt` | CA path, resolved relative to backend project directory; certificate must be readable at startup |
| `ELASTICSEARCH_API_KEY` | Backend | Optional | Elasticsearch API-key authentication (preferred when supplied) |
| `ELASTICSEARCH_USERNAME` | Backend | Optional | Elasticsearch basic-auth username when used with password |
| `ELASTICSEARCH_PASSWORD` | Backend | Optional | Elasticsearch basic-auth password when used with username |
| `SLACK_CLIENT_ID` | Backend | Optional until Slack OAuth | Slack app client ID |
| `SLACK_CLIENT_SECRET` | Backend | Optional until Slack OAuth | Slack app client secret |
| `SLACK_REDIRECT_URI` | Backend | Optional until Slack OAuth | Registered Slack redirect URI |
| `SLACK_SCOPES` | Backend | Optional; `chat:write` | Bot OAuth scopes |
| `SLACK_NOTIFICATION_CHANNEL_ID` | Backend | Optional until notifications are enabled | Target channel for worker notifications |
| `SLACK_TOKEN_ENCRYPTION_KEY` | Backend | Optional until token storage; needs at least 32 bytes | Key material for encrypted OAuth tokens |
| `GOOGLE_CLIENT_ID` | Backend | Required for Google login | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Backend | Required for Google login | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Backend | `http://localhost:5000/api/auth/google/callback` | Registered Google OAuth callback URL |
| `AUTH_SESSION_SECRET` | Backend | Required for Google login; at least 32 bytes | Signs application session cookies |
| `AUTH_SESSION_SECRET` | Backend | Optional until session signing; at least 32 bytes | Signs session cookies |
| `FRONTEND_URL` | Backend | Optional; `http://localhost:5173` | OAuth redirect destination and CORS fallback |
| `CORS_ALLOWED_ORIGINS` | Backend | Optional; derived from `FRONTEND_URL` | Comma-separated exact HTTP(S) origins |
| `BULL_BOARD_ENABLED` | Backend | Optional; true except in production | Enables Bull Board |
| `QUEUE_DASHBOARD_USERNAME` | Backend | Optional in env validation; required to access enabled dashboard | Bull Board Basic Auth username |
| `QUEUE_DASHBOARD_PASSWORD` | Backend | Optional in env validation; required to access enabled dashboard | Bull Board Basic Auth password |
| `VITE_API_URL` | Frontend | Optional; `http://localhost:5000/api` | API base URL; browser-visible configuration only |
| `VITE_DEV_USER_ID` | Frontend | Optional | Existing app user UUID sent as `x-user-id` in development only |

For local startup, note that the Elasticsearch client reads the configured CA file during module initialization even if the endpoint is local. Provide the certificate file or change the CA path to a readable certificate appropriate for the Elasticsearch endpoint; do not disable TLS verification.
