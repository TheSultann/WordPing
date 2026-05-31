# Contributing To WordPing

Thanks for your interest in WordPing. This project is a TypeScript monorepo with a Telegram bot, Express API, scheduled workers, Prisma/Postgres persistence, and a React/Vite Telegram Mini App.

## Good First Contributions

- Improve setup, deployment, and operational documentation.
- Add or refresh screenshots for the Telegram bot and Mini App.
- Expand tests for bot flows, API contracts, workers, the news pipeline, and backup scripts.
- Improve Mini App accessibility, empty states, and local development ergonomics.
- Review CI and security-sensitive flows.

## Local Setup

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate deploy
```

Configure at least:

- `BOT_TOKEN`
- `DATABASE_URL`

Run local services:

```bash
npm run dev:api
npm run dev:bot
npm run dev:worker
npm run dev:news-worker
npm run dev:web
```

## Development Guidelines

- Preserve the split between bot, API, workers, services, utilities, and frontend code.
- Keep `src/scheduler/worker.ts` free of direct external news provider calls.
- Put news fetching and fallback logic in `src/scheduler/newsWorker.ts` and `src/services/news*`.
- Keep database timestamps in UTC.
- Respect existing timezone logic for scheduling and notification windows.
- Prefer extending existing services and utilities over duplicating logic in handlers, routes, or workers.
- Do not introduce new dependencies unless the change clearly needs them.
- Update docs and `.env.example` when behavior, environment variables, deployment, backups, or operational commands change.
- Keep Prisma migrations and generated client expectations in sync when the schema changes.

## Validation

Run the smallest relevant checks while iterating. Before handing off most code changes, run:

```bash
npm run lint
npm test
npm run build
```

When `web/` changes, also run:

```bash
npm run build:web
```

When Prisma schema or migrations change, also run:

```bash
npx prisma generate
```

When shell scripts or release flow change, also run:

```bash
bash -n scripts/*.sh
```

## Pull Requests

- Keep pull requests focused and describe the user-visible behavior.
- Link related issues when possible.
- Include screenshots or recordings for Mini App and Telegram UI changes.
- Mention which validation commands were run.
- Call out any migration, environment, or deployment impact.
