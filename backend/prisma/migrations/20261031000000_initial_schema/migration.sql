-- Initial schema baseline for installations previously provisioned with `prisma db push`.
-- Every operation is additive: existing tables and rows are retained.
CREATE SCHEMA IF NOT EXISTS "public";

DO $$ BEGIN
  CREATE TYPE "EmailJobStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TYPE "EmailJobStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "EmailJobStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "EmailJobStatus" ADD VALUE IF NOT EXISTS 'SENT';
ALTER TYPE "EmailJobStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "EmailJobStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

DO $$ BEGIN
  CREATE TYPE "EmailEventType" AS ENUM ('SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED', 'RATE_LIMITED', 'RESCHEDULED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'SENT';
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'RATE_LIMITED';
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'RESCHEDULED';

CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "googleId" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sender_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "sender_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_jobs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "senderAccountId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "status" "EmailJobStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "minimumDelayMs" INTEGER,
    "hourlyLimit" INTEGER,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_recipients" (
    "id" UUID NOT NULL,
    "emailJobId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_recipients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_attachments" (
    "id" UUID NOT NULL,
    "emailJobId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_events" (
    "id" UUID NOT NULL,
    "emailJobId" UUID NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "slack_connections" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "teamId" VARCHAR(64),
    "teamName" TEXT,
    "slackUserId" VARCHAR(64),
    "encryptedAccessToken" TEXT NOT NULL,
    "connectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "slack_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");
CREATE INDEX IF NOT EXISTS "sender_accounts_userId_idx" ON "sender_accounts"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "sender_accounts_userId_email_key" ON "sender_accounts"("userId", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "email_jobs_idempotencyKey_key" ON "email_jobs"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "email_jobs_userId_idx" ON "email_jobs"("userId");
CREATE INDEX IF NOT EXISTS "email_jobs_status_idx" ON "email_jobs"("status");
CREATE INDEX IF NOT EXISTS "email_jobs_scheduledAt_idx" ON "email_jobs"("scheduledAt");
CREATE INDEX IF NOT EXISTS "email_jobs_senderAccountId_idx" ON "email_jobs"("senderAccountId");
CREATE INDEX IF NOT EXISTS "email_jobs_userId_status_scheduledAt_idx" ON "email_jobs"("userId", "status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "email_recipients_email_idx" ON "email_recipients"("email");
CREATE INDEX IF NOT EXISTS "email_recipients_emailJobId_idx" ON "email_recipients"("emailJobId");
CREATE INDEX IF NOT EXISTS "email_attachments_emailJobId_idx" ON "email_attachments"("emailJobId");
CREATE INDEX IF NOT EXISTS "email_events_emailJobId_idx" ON "email_events"("emailJobId");
CREATE UNIQUE INDEX IF NOT EXISTS "slack_connections_userId_key" ON "slack_connections"("userId");
CREATE INDEX IF NOT EXISTS "slack_connections_teamId_idx" ON "slack_connections"("teamId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sender_accounts_userId_fkey' AND conrelid = 'sender_accounts'::regclass) THEN
    ALTER TABLE "sender_accounts" ADD CONSTRAINT "sender_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_jobs_userId_fkey' AND conrelid = 'email_jobs'::regclass) THEN
    ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_jobs_senderAccountId_fkey' AND conrelid = 'email_jobs'::regclass) THEN
    ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "sender_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_recipients_emailJobId_fkey' AND conrelid = 'email_recipients'::regclass) THEN
    ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_emailJobId_fkey" FOREIGN KEY ("emailJobId") REFERENCES "email_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_attachments_emailJobId_fkey' AND conrelid = 'email_attachments'::regclass) THEN
    ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_emailJobId_fkey" FOREIGN KEY ("emailJobId") REFERENCES "email_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_events_emailJobId_fkey' AND conrelid = 'email_events'::regclass) THEN
    ALTER TABLE "email_events" ADD CONSTRAINT "email_events_emailJobId_fkey" FOREIGN KEY ("emailJobId") REFERENCES "email_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slack_connections_userId_fkey' AND conrelid = 'slack_connections'::regclass) THEN
    ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
