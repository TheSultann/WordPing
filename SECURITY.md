# Security Policy

## Supported Versions

WordPing is maintained from the `main` branch. Security fixes target `main` unless a separate release branch exists.

## Reporting A Vulnerability

Do not open a public issue for suspected vulnerabilities.

Report security concerns by contacting the maintainer privately through GitHub. Include:

- a short description of the issue;
- affected code paths or configuration;
- reproduction steps, proof of concept, or logs if safe to share;
- the expected impact;
- any suggested fix or mitigation.

The maintainer will acknowledge valid reports as soon as possible and coordinate a fix before public disclosure.

## Security-Sensitive Areas

- Telegram bot tokens and webhook configuration.
- Telegram WebApp init data validation (`src/api/auth.ts`).
- Mini App development authentication through `ALLOW_DEV_AUTH`.
- Database credentials and Prisma migrations.
- News provider API keys and external fetch handling.
- Backup archives, restore commands, and Telegram backup delivery.
- CI/CD secrets and production deployment scripts.

## Authentication & Authorization

### Telegram WebApp Init Data
- Requests to `/api/*` (except `/api/health` and `/api/ready`) require a valid `x-telegram-init-data` header.
- Validation uses HMAC-SHA256 with the `WebAppData` constant and the bot token, per Telegram's official spec.
- Hash comparison uses `crypto.timingSafeEqual` to prevent timing attacks.
- `auth_date` freshness is enforced via `INIT_DATA_MAX_AGE_SECONDS` (default: **3600 seconds / 1 hour**).
  - For Mini Apps, 1–6 hours is typical. The maximum allowed value is 86400 (24h).
  - Tune this based on your session flow; shorter is safer.
- Missing `hash`, `user`, or `auth_date` fields are rejected with specific error codes.

### Development Authentication
- `ALLOW_DEV_AUTH=true` enables header-based dev auth (`x-dev-user-id`) **only** when `NODE_ENV !== 'production'`.
- The startup validator (`validateRuntimeEnv`) throws immediately if `ALLOW_DEV_AUTH` is enabled in production.
- Dev auth usage is logged at warn level for audit trail.
- **Never set `ALLOW_DEV_AUTH=true` in production environments.**

### Admin Access
- Admin endpoints (`/api/admin/*`) require `telegramUserId === ADMIN_TELEGRAM_ID` (BigInt comparison).
- All admin access attempts (granted and denied) are audit-logged.
- Recommendation: deploy behind a reverse proxy with rate limiting on admin paths.

## CORS Policy

- In production, allowed origins come exclusively from `WEB_ORIGIN`.
- If `WEB_ORIGIN` is not set in production, the API server **refuses to start** (fail-fast).
- In development, `localhost:5173` is added to allowed origins by default.

## Backup & Restore Scripts

- `scripts/backup-db.mjs` and `scripts/restore-db.mjs` use `pg_dump`/`pg_restore` with `--dbname=DATABASE_URL`.
- `DATABASE_URL` is passed as a process argument, making it visible in `ps` output. This is acceptable for dedicated server backup cron jobs. For multi-tenant or shared environments, use `PGPASSFILE` or `pg_service.conf`.
- Backup dump files (`.dump`) are stored in a local directory (default: `./backups/postgres`) and are **not served by the web server**. Ensure your nginx/reverse proxy does not expose this path.
- Backup notification is sent to the admin's Telegram chat only.

## CI/CD Security

- Production secrets (`BOT_TOKEN`, `DATABASE_URL`, etc.) are stored as GitHub Actions secrets or environment-level variables and never logged.
- Deploy and migration workflows use AWS SSM (Systems Manager) for remote command execution — no SSH keys in CI.
- `BOT_TOKEN` appears in CI only as a test fixture value (`test-token`), never the real token.

## Operational Guidance

- Keep `ALLOW_DEV_AUTH=false` in production.
- Never commit `.env`, database dumps, bot tokens, API keys, or production logs.
- Rotate credentials after accidental exposure.
- Review `.env.example`, deployment scripts, and GitHub Actions when adding new secrets.
- Prefer least-privilege credentials for databases, providers, and deployment hosts.
- Set `INIT_DATA_MAX_AGE_SECONDS` to the shortest acceptable value for your use case.
- Ensure the backup directory is not accessible through the web server.
