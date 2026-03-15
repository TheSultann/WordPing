# Project Guidelines

## Architecture
- The backend lives under `src/` and has four entrypoints: `src/bot/index.ts`, `src/api/index.ts`, `src/scheduler/worker.ts`, and `src/scheduler/newsWorker.ts`.
- Keep entrypoints thin. Put domain logic in `src/services/`, shared utilities in `src/utils/`, and database access through Prisma.
- Treat `prisma/schema.prisma` as the source of truth for data model changes. Do not edit generated Prisma client files.
- The Mini App lives in `web/` as a separate Vite + React app that talks to the backend through `/api`.

## Build and Test
- Install backend dependencies with `npm install` at the repo root.
- Install frontend dependencies with `npm --prefix web install` when working in `web/`.
- Backend and shared TypeScript build: `npm run build`.
- Web build: `npm run build:web`.
- Test suite: `npm test` or `npm run test:coverage`.
- Development entrypoints: `npm run dev:bot`, `npm run dev:worker`, `npm run dev:news-worker`, `npm run dev:api`, and `npm run dev:web`.
- Prisma workflow: use `npm run prisma:generate` after schema changes; use `npm run migrate:dev` for local development and `npm run migrate:deploy` for non-interactive deploys.

## Conventions
- Match the existing strict TypeScript style. This repo uses `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`, so prefer explicit types and narrow nullish values carefully.
- Keep database timestamps in UTC. Any user-facing time or day-boundary logic should go through the existing timezone utilities rather than ad hoc `Date` math.
- Every learned word creates two independent review cards for opposite directions. Review logic changes must preserve that two-card model.
- External news fetching belongs only in the news pipeline. Do not add news API calls to the main worker or bot handlers.
- Telegram IDs may be stored as `BigInt` in persistence paths. Avoid converting DB-facing identifiers to plain numbers unless the surrounding code already does so safely.
- Follow the existing services-first pattern: bot handlers, API routes, and workers should orchestrate services instead of embedding business rules inline.

## Testing Notes
- Vitest uses `tests/setup.ts` to prepare the environment before Prisma loads. Keep that setup intact when changing test bootstrapping.
- When mocking modules in Vitest, declare `vi.mock(...)` before importing the module under test if the existing test follows that pattern.
- Prefer updating or adding focused tests near the affected behavior instead of broad fixture rewrites.

## Web App Notes
- The web app uses a Vite proxy from `/api` to `http://localhost:3001` in development.
- Mini App auth uses `x-telegram-init-data` in normal operation and supports `?devUserId=...` only for local development when dev auth is enabled.
- Keep frontend changes consistent with the existing component and CSS-variable approach in `web/src/`.