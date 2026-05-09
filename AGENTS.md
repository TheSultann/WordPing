# AGENTS.md

## Project Scope

WordPing is a TypeScript repository with one backend application and one frontend Mini App.

- Backend: Telegram bot, Express API, Prisma/Postgres, scheduled workers.
- Frontend: React + Vite Mini App in `web/`.
- Production processes: `api`, `bot`, `worker`, `news-worker`.

## Repository Map

- `src/bot` - Telegram bot flows, callback payloads, quiz/settings/news digest UI, and runtime logic.
- `src/api` - Express API for the Mini App and health/readiness endpoints.
- `src/scheduler/worker.ts` - main review/reminder worker.
- `src/scheduler/newsWorker.ts` - news-only worker for RSS/news resolution.
- `src/services` - business logic for SRS, quiz, translation, sessions, users, and news pipeline.
- `src/utils` - shared helpers for env parsing, logging, runtime health, time, and text handling.
- `prisma` - Prisma schema and migrations.
- `tests` - Vitest coverage for bot, API, services, workers, news, backup, and release flow.
- `web` - React/Vite Mini App.
- `scripts` - backup, restore, deploy, migration, and rollback scripts.
- `.github/workflows` - CI, deploy, and migration workflows.

## Working Rules

- Preserve the current split of responsibilities.
- `src/scheduler/worker.ts` must not call external news providers directly.
- External news fetching and fallback logic belongs only to `src/scheduler/newsWorker.ts` and `src/services/news*`.
- Keep DB timestamps in UTC.
- User-facing scheduling and notification windows must continue to respect the existing timezone logic.
- Prefer extending existing services and utilities over duplicating logic in handlers, routes, or workers.
- Keep changes aligned with the current stack: TypeScript backend, React/Vite frontend, Vitest tests, Prisma/Postgres persistence.
- If behavior, env vars, deploy flow, backup flow, or operational commands change, update the relevant docs such as `README.md`, `DEPLOY.md`, or `.env.example`.
- If Prisma schema or generated client usage changes, keep migrations and generated client expectations in sync.

## Validation

Run the smallest relevant checks while iterating, then run the required final checks before handing work off.

### Default final checks

Run these for most code changes:

```bash
npm run lint
npm test
npm run build
```

### When `web/` changes

Also run:

```bash
npm run build:web
```

### When Prisma schema or migrations change

Also run:

```bash
npx prisma generate
```

If schema changes can affect API, bot, worker, or web behavior, run the default final checks and `npm run build:web`.

### When shell scripts or release flow change

Also run:

```bash
bash -n scripts/*.sh
```

Review `DEPLOY.md` and the relevant workflow files if the operational flow changed.

## Change Guidance

- For bot flow changes, check callback payload helpers, runtime state transitions, and relevant tests under `tests/bot*`, `tests/*quiz*`, `tests/*settings*`, and `tests/*news*`.
- For API changes, verify Mini App contracts in `web/src/api.ts` and related API tests.
- For worker changes, verify reminder, review, session, and runtime health edge cases.
- For news pipeline changes, keep enqueue, resolve, refresh, and provider limit handling separated as they are today.
- For frontend changes, preserve existing Mini App behavior and ensure the app still works in Telegram WebApp context and local dev mode.

## Environment Notes

- Backend env comes from repo root `.env`.
- Frontend env comes from `web/.env`.
- Important runtime variables include `BOT_TOKEN`, `DATABASE_URL`, `ADMIN_TELEGRAM_ID`, and `WEBAPP_URL`.
- Production serves `web/dist` through nginx, so frontend work is not complete until the frontend build is updated.

## Practical Defaults For Codex

- Prefer root-level commands unless the task is explicitly frontend-only.
- Use `npm --prefix web ...` only for frontend package operations.
- Do not introduce new dependencies unless the task clearly requires them.
- Favor targeted fixes over broad refactors unless the task explicitly asks for structural cleanup.
