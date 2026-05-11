# Production Deploy

This document describes the professional release flow for WordPing production deployments.

## Standard Release Flow

1. Push working changes to a feature branch.
2. Open a pull request into `main`.
3. Wait for `.github/workflows/ci.yml` to pass.
4. If the release contains Prisma schema changes, run `.github/workflows/migrate-aws-ec2.yml` first.
5. Merge into `main`.
6. Let `.github/workflows/deploy-aws-ec2.yml` deploy the application to AWS EC2 through SSM.

This keeps production deployments tied to tested Git commits instead of manual shell sessions.

## Local Release Preparation

```bash
git checkout -b feature/release-prep
npm ci
npm --prefix web ci
npm run lint
npm test
npm run build
npm run build:web
git add .
git commit -m "Prepare production release"
git push -u origin feature/release-prep
```

## First Server Bootstrap

```bash
cd ~/apps
git clone <YOUR_GITHUB_REPO_URL> WordPing
cd ~/apps/WordPing
npm ci
npm --prefix web ci
mkdir -p .deploy/shared
chmod +x scripts/*.sh
```

The deploy workflow expects this server layout:

- Git repo path: `/home/<user>/apps/WordPing`
- Release storage: `/home/<user>/apps/WordPing/.deploy`
- Frontend static root: `/var/www/wordping`
- Active release symlink: `.deploy/current`
- Previous release symlink: `.deploy/previous`
- Failed release symlink: `.deploy/failed`
- PM2 config: `current/ecosystem.config.cjs`
- Deploy entrypoint: `scripts/deploy-prod.sh`
- Rollback entrypoint: `scripts/rollback-prod.sh`
- Migration entrypoint: `scripts/migrate-prod.sh`

Recommended shared environment files:

- App env: `.deploy/shared/.env`
- Web env: `.deploy/shared/web.env`

The scripts also fall back to `repo/.env` and `repo/web/.env` for backward compatibility.

## GitHub To AWS Deploy

Production deployment uses GitHub Actions plus AWS Systems Manager Run Command.

Automatic production deploys run on push to `main`.

Manual production deploys are limited to:

- `main`
- `release-*` tags

Manual production migrations are limited to the same approved refs:

- `main`
- `release-*` tags

Set these GitHub Actions repository or environment variables:

- `AWS_REGION`
- `AWS_EC2_INSTANCE_ID`
- `AWS_DEPLOY_ROLE_ARN`
- `AWS_DEPLOY_USER` - optional, defaults to `ubuntu`
- `AWS_APP_DIR` - optional, defaults to `/home/<user>/apps/WordPing`
- `PUBLIC_URL` - optional

Recommended GitHub setup:

- Create a GitHub environment named `production`.
- Add required reviewers for that environment.
- Attach the variables above to the `production` environment.
- Keep `.github/workflows/deploy-aws-ec2.yml` and `.github/workflows/migrate-aws-ec2.yml` serialized through the shared `production-operations` concurrency group.

Recommended AWS setup:

- Attach an IAM role to the EC2 instance so it is managed by Systems Manager.
- Configure GitHub OIDC to assume `AWS_DEPLOY_ROLE_ARN`.
- Keep application secrets on the server or in AWS Secrets Manager / Parameter Store.
- If the repository is private, configure a deploy key or GitHub App access on the server for `git fetch`.

## Safe Migration Flow

Application deploys do not run `prisma migrate deploy`.

`scripts/deploy-prod.sh` checks `npx prisma migrate status` and refuses to switch releases if the target commit still needs database migrations. This prevents new application code from running against an old schema.

For schema changes:

1. Run `.github/workflows/migrate-aws-ec2.yml` with `main` or an approved `release-*` tag.
2. Confirm that the migration script created a local pre-migration PostgreSQL backup.
3. Deploy the application only after the migration flow has completed.

Manual migration:

```bash
cd ~/apps/WordPing
./scripts/migrate-prod.sh origin/main
```

The latest migration backup path is written to:

```text
.deploy/shared/last-pre-migration-backup.txt
```

## Manual Server Deploy

Deploy `origin/main`:

```bash
cd ~/apps/WordPing
./scripts/deploy-prod.sh origin/main
```

Deploy a specific release tag:

```bash
cd ~/apps/WordPing
./scripts/deploy-prod.sh refs/tags/release-2026-03-25-rc1
```

## Rollback

`scripts/deploy-prod.sh` deploys into timestamped release folders under `.deploy/releases/`.

The deploy script waits on:

```http
GET /api/ready
```

`GET /api/health` remains strict for monitoring and can return `503` if a background worker recently logged a task failure.

If PM2 reload fails or post-deploy readiness checks fail, the script automatically:

1. Repoints `.deploy/current` back to the previous release.
2. Restores `.deploy/previous` to the prior known-good release.
3. Stores the failed rollout in `.deploy/failed`.
4. Resyncs the previous frontend build into `/var/www/wordping`.
5. Reloads PM2 with the previous release.
6. Rechecks readiness.

Manual rollback:

```bash
cd ~/apps/WordPing
./scripts/rollback-prod.sh
```

Rollback to a specific stored release:

```bash
cd ~/apps/WordPing
./scripts/rollback-prod.sh 20260327T120000Z-abcdef123456
```

## Mini App Static Deploy

Mini App static files are served by nginx, not by the Node API.

- Public URL: `https://wordping.duckdns.org`
- Nginx static root: `/var/www/wordping`
- Frontend build output: `~/apps/WordPing/web/dist`

After every `npm run build:web`, sync `web/dist` into `/var/www/wordping/` and reload nginx. Otherwise production may continue serving an old frontend build.

## Nightly Backup

Recommended cron:

```bash
0 3 * * * cd ~/apps/WordPing && /usr/bin/npm run backup:db >> ~/apps/WordPing/backups/backup.log 2>&1
```

Install it directly:

```bash
npm run install:backup-cron
```

## Required Environment

Application:

- `BOT_TOKEN`
- `DATABASE_URL`
- `ADMIN_TELEGRAM_ID`
- `WEBAPP_URL`

Production should also keep:

```env
ALLOW_DEV_AUTH=false
```

Backup delivery:

- `BACKUP_DIR`
- `BACKUP_FILE_PREFIX`
- `BACKUP_RETENTION_COUNT`

Optional for large dumps:

- `TELEGRAM_BOT_API_BASE_URL`
- `TELEGRAM_MAX_UPLOAD_MB`
- `PG_DUMP_BIN`
- `PG_RESTORE_BIN`
