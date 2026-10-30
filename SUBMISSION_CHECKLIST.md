# Submission Checklist

Unchecked items have not been confirmed in this documentation pass. Do not mark runtime items complete until evidence has been collected.

## Code and repository

- [ ] Private GitHub repository created
- [ ] Required collaborators added
- [ ] No credentials, `.env` files, local Elasticsearch CA files, or uploaded attachments committed
- [x] Root README present
- [x] Architecture documentation present
- [x] Feature/requirement mapping present
- [ ] Final repository scan for secrets and generated artifacts

## Backend and services

- [ ] API startup and health endpoint verified
- [ ] PostgreSQL schema synchronized and data operations verified
- [ ] Redis connection and BullMQ scheduling verified
- [ ] Worker concurrency verified
- [ ] Ethereal/SMTP send verified
- [ ] Minimum inter-email delay verified across workers
- [ ] Global and per-sender hourly limits verified
- [ ] Rate-limited jobs rescheduled and events checked
- [ ] Slack OAuth and channel notification verified in a test workspace
- [ ] Elasticsearch initialization, indexing, search, and reindex verified
- [ ] Attachment upload and SMTP delivery verified
- [ ] Bull Board Basic Auth and read-only behavior verified
- [ ] Cancellation and failed-job retry verified
- [ ] 1000+ scheduled jobs load test completed
- [ ] Restart/persistence test completed

## Frontend

- [ ] Development authentication configured with an existing user
- [ ] Sender selection checked
- [ ] Compose and future schedule checked
- [ ] Recipient list parsing checked
- [ ] Attachment selection/submission checked
- [ ] Scheduled and sent pages checked with live data
- [ ] Search, status filter, and pagination checked
- [ ] Email detail, event history, cancellation, and retry checked
- [ ] Desktop, tablet, and mobile browser review completed

## Testing and submission

- [ ] Backend production build run against final commit
- [ ] Frontend production build run against final commit
- [ ] Manual/integration test evidence captured without secrets
- [ ] Full end-to-end flow completed
- [ ] Demo video recorded
- [ ] Architecture and feature explanation prepared
- [ ] Repository access confirmed for evaluator
- [ ] README and documentation reviewed against final code

Google OAuth is implemented in the frontend and backend; complete a real browser login before reporting the flow as runtime-verified. See [FEATURES.md](FEATURES.md#known-limitations) and [TESTING.md](TESTING.md).
