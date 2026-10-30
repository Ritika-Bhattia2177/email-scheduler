# ReachInbox Email Scheduler

A full-stack email scheduling application for the ReachInbox hiring assignment. It uses a React/Vite frontend, an Express/TypeScript API, PostgreSQL through Prisma, BullMQ backed by Redis, Elasticsearch search, and Nodemailer with Ethereal SMTP for local testing.

## Capabilities

| Feature | Implementation status | Notes |
|---|---|---|
| Schedule and cancel email jobs | Implemented; runtime verification pending | PostgreSQL state plus BullMQ delayed jobs |
| Worker concurrency | Implemented; runtime verification pending | Configurable with `WORKER_CONCURRENCY` |
| Minimum delay and hourly limits | Implemented; runtime verification pending | Redis Lua coordination; global and sender quotas |
| Rate-limit rescheduling | Implemented; runtime verification pending | Updates the existing job schedule and delays the same BullMQ job |
| Idempotent scheduling | Implemented; runtime verification pending | Unique PostgreSQL `EmailJob.idempotencyKey` |
| SMTP delivery | Implemented; runtime verification pending | Configured SMTP or a generated Ethereal test account in development |
| Email search | Implemented; runtime verification pending | Elasticsearch query with PostgreSQL ownership/status recheck |
| Slack rate-limit notifications | Implemented; real workspace delivery pending verification | OAuth connection, encrypted stored token, configured channel |
| File attachments | Implemented; runtime verification pending | Local disk storage, attached to email jobs and sent with Nodemailer |
| Queue dashboard | Implemented; access verification pending | Read-only Bull Board at `/admin/queues` when enabled |
| Google sign-in | Implemented; browser sign-in still needs manual verification | OpenID Connect login, verified Google identity, and an HttpOnly application session |

“Implemented” describes code present in the repository; it does not mean the complete runtime flow has been verified. See [TESTING.md](TESTING.md) and [FEATURES.md](FEATURES.md).

## Architecture and request flow

The API validates a scheduling request, checks sender ownership, writes the job and recipient/attachment metadata to PostgreSQL, then enqueues one delayed BullMQ job using a stable ID derived from the email job ID. Redis stores BullMQ state and coordinates send reservations across workers. The worker checks state and rate limits before sending; successful sends update PostgreSQL and Elasticsearch. Rate-limited jobs stay scheduled and are delayed again. See [ARCHITECTURE.md](ARCHITECTURE.md) for the component diagram and details.

## Requirements

- Node.js 20 or later recommended (the inspected development environment uses Node 22.12.0; package manifests do not pin a Node version)
- npm
- PostgreSQL
- Redis
- Elasticsearch and its CA certificate file (the backend reads the configured CA at startup)

No Docker or repository clone URL is provided by this project. Start the services using your local installation or managed service.

## Local setup

### 1. Backend

```sh
cd backend
npm install
cp .env.example .env
```

Set a valid PostgreSQL `DATABASE_URL`. Start PostgreSQL, Redis, and Elasticsearch. Set `ELASTICSEARCH_NODE`, authentication, and `ELASTICSEARCH_CA_CERT_PATH` as needed. The example CA path is `./http_ca.crt`, resolved relative to the backend project directory; place the CA from your own Elasticsearch installation there or configure an absolute path. TLS verification remains enabled.

For local SMTP, leave both `SMTP_USER` and `SMTP_PASSWORD` empty to use a generated Ethereal test account, or supply both values together. For Slack notifications, configure the Slack variables listed in [Environment variables](#environment-variables) and connect a workspace through the Slack OAuth routes.

Generate the Prisma client and sync the schema:

```sh
npm run prisma:generate
npx prisma db push
npm run dev
```

The API defaults to port `5000`. The backend package also defines `npm run build` and `npm start`. Although a `prisma:migrate` script exists, this checkout has no migration files; local setup therefore uses `db push`.

### 2. Local development identity

For local testing without Google, set `AUTH_MODE=development` in `backend/.env` and `VITE_DEV_USER_ID` in `frontend/.env` to an existing user UUID. The frontend sends this as `x-user-id` only in Vite development mode. Google sign-in uses the backend OAuth routes and a signed HttpOnly session cookie. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and a random `AUTH_SESSION_SECRET` of at least 32 bytes in the backend environment. Register `http://localhost:5000/api/auth/google/callback` as the Google OAuth redirect URI. Production authentication requires the backend session cookie; do not enable development auth in production.

### 3. Frontend

```sh
cd frontend
npm install
cp .env.example .env
npm run dev
```

Vite defaults to `http://localhost:5173`; `VITE_API_URL` defaults to `http://localhost:5000/api`. The login page supports Google sign-in and shows the development-user continuation only when `VITE_DEV_USER_ID` is configured.

## Environment variables

See [backend/.env.example](backend/.env.example) and [frontend/.env.example](frontend/.env.example) for the actual names and local defaults. A complete reference, including requirement and default behavior, is in [API.md](API.md#environment-variables) (environment configuration section).

Important settings:

- `EMAIL_DELAY_MS`: default minimum delay between successful sends.
- `MAX_EMAILS_PER_HOUR`: global rolling hourly ceiling.
- `MAX_EMAILS_PER_SENDER_PER_HOUR`: maximum sender-specific hourly ceiling.
- An email job may request a smaller `minimumDelayMs` or `hourlyLimit`; the per-job sender limit cannot raise the configured sender maximum. The global limit always applies.
- `WORKER_CONCURRENCY`: concurrent BullMQ worker jobs; default `5`.
- `BULL_BOARD_ENABLED`: enables `/admin/queues`; credentials must be configured before access.

## API and project documentation

- [API.md](API.md): API routes, authentication, request formats, responses, and errors.
- [ARCHITECTURE.md](ARCHITECTURE.md): services, queue lifecycle, scheduling, rate limiting, search, and persistence.
- [FEATURES.md](FEATURES.md): assignment requirement mapping and verification status.
- [TESTING.md](TESTING.md): repeatable verification plan; tests are not claimed as run.
- [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md): handoff checklist.

## Project structure

```text
emailScheduler/
├── backend/
│   ├── prisma/schema.prisma
│   ├── src/config/       # environment, PostgreSQL, Redis, Elasticsearch, Bull Board
│   ├── src/routes/       # health, auth, email, sender, Slack APIs
│   ├── src/services/     # scheduling, rate limits, delivery, search, attachments, Slack
│   ├── src/queues/       # BullMQ queue and job types
│   ├── src/workers/      # email worker
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/components/   # layout, compose, email, and common UI
│   ├── src/hooks/
│   ├── src/pages/
│   ├── src/routes/
│   ├── src/services/
│   ├── package.json
│   └── .env.example
├── README.md
├── ARCHITECTURE.md
├── API.md
├── FEATURES.md
├── TESTING.md
└── SUBMISSION_CHECKLIST.md
```

There is no checked-in `prisma/migrations` directory, Docker configuration, or dedicated automated test directory in this checkout.

## Security and limitations

Keep backend `.env` files, credentials, OAuth secrets, and encryption keys private. Do not put backend secrets in frontend `VITE_*` variables. Attachment storage and Elasticsearch CA files are machine-specific and ignored by Git. Sender, email, and search endpoints scope records to the authenticated user. Bull Board is read-only and Basic Auth protected.

Google OAuth code is implemented but has not yet been verified through a real browser login. Slack delivery, rate-limit timing, 1000+ job behavior, restart persistence, and the full browser-to-SMTP flow remain pending separate runtime verification. Attachments are local files with no download API. See [Known limitations](FEATURES.md#known-limitations).
