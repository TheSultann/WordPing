## Professional Flow

1. Push working changes to a feature branch.
2. Open a pull request into `main`.
3. Wait for `.github/workflows/ci.yml` to pass.
4. If the release contains Prisma schema changes, run `.github/workflows/migrate-aws-ec2.yml` first.
5. Merge into `main`.
6. Let `.github/workflows/deploy-aws-ec2.yml` deploy the application to AWS EC2 through SSM.

This keeps production deploys tied to a tested Git commit instead of ad-hoc shell sessions.

## Local Git Push

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

The deploy workflow expects the app repo on the server and uses:

- Git repo path: `/home/<user>/apps/WordPing` by default
- Release storage: `/home/<user>/apps/WordPing/.deploy`
- Frontend root: `/var/www/wordping`
- Active release symlink: `.deploy/current`
- Previous release symlink: `.deploy/previous`
- Failed release symlink: `.deploy/failed`
- PM2 config: `current/ecosystem.config.cjs`
- Server deploy entrypoint: `scripts/deploy-prod.sh`
- Manual rollback entrypoint: `scripts/rollback-prod.sh`
- Safe migration entrypoint: `scripts/migrate-prod.sh`

Recommended server layout for shared env files:

- App env: `.deploy/shared/.env`
- Web env: `.deploy/shared/web.env`

The scripts also fall back to `repo/.env` and `repo/web/.env` for backward compatibility.

## GitHub To AWS Deploy

The production workflow uses GitHub Actions plus AWS Systems Manager Run Command.

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
- `AWS_DEPLOY_USER` (optional, defaults to `ubuntu`)
- `AWS_APP_DIR` (optional, defaults to `/home/<user>/apps/WordPing`)
- `PUBLIC_URL` (optional)

Recommended GitHub setup:

- Create a GitHub environment named `production`
- Add required reviewers for that environment
- Attach the variables above to the `production` environment
- Keep `.github/workflows/deploy-aws-ec2.yml` and `.github/workflows/migrate-aws-ec2.yml` serialized through the shared `production-operations` concurrency group

Recommended AWS setup:

- Attach an IAM role to the EC2 instance so it is managed by Systems Manager
- Configure GitHub OIDC to assume `AWS_DEPLOY_ROLE_ARN`
- Keep application secrets on the server or in AWS Secrets Manager / Parameter Store
- If the repository is private, configure a deploy key or GitHub App access on the server for `git fetch`

## Safe Migration Flow

Application deploys no longer run `prisma migrate deploy`.

`scripts/deploy-prod.sh` now checks `npx prisma migrate status` and refuses to switch releases if the target commit still needs DB migrations. This prevents accidental “new code against old schema” deploys.

For schema changes:

1. Run `.github/workflows/migrate-aws-ec2.yml` with `main` or an approved `release-*` tag.
2. The migration script creates a local pre-migration PostgreSQL backup.
3. Only after that run or merge the application deploy.

Manual migration:

```bash
cd ~/apps/WordPing
./scripts/migrate-prod.sh origin/main
```

The latest migration backup path is written to:

- `.deploy/shared/last-pre-migration-backup.txt`

## Manual Server Deploy

```bash
cd ~/apps/WordPing
./scripts/deploy-prod.sh origin/main
```

Or deploy a specific release tag:

```bash
cd ~/apps/WordPing
./scripts/deploy-prod.sh refs/tags/release-2026-03-25-rc1
```

## Automatic Rollback

`scripts/deploy-prod.sh` now deploys into timestamped release folders under `.deploy/releases/`.

The deploy script waits on `GET /api/ready` as the rollout gate.

`GET /api/health` stays strict for monitoring and can still report `503` if a background worker recently logged a task failure.

If PM2 reload fails or post-deploy healthchecks fail, the script automatically:

1. Repoints `.deploy/current` back to the previous release
2. Restores `.deploy/previous` to the prior known-good release
3. Stores the failed rollout in `.deploy/failed`
4. Resyncs the previous frontend build into `/var/www/wordping`
5. Reloads PM2 with the previous release
6. Rechecks readiness

Manual rollback is still available:

```bash
cd ~/apps/WordPing
./scripts/rollback-prod.sh
```

Or rollback to a specific stored release:

```bash
cd ~/apps/WordPing
./scripts/rollback-prod.sh 20260327T120000Z-abcdef123456
```

## Mini App Static Deploy

Mini App static files are served by `nginx`, not by the Node API.

- Public URL: `https://wordping.duckdns.org`
- Nginx static root: `/var/www/wordping`
- Frontend build output: `~/apps/WordPing/web/dist`

After every `npm run build:web`, sync `web/dist` into `/var/www/wordping/` and reload `nginx`, otherwise production may continue serving an old frontend build.

## Nightly Backup

```bash
0 3 * * * cd ~/apps/WordPing && /usr/bin/npm run backup:db >> ~/apps/WordPing/backups/backup.log 2>&1
```

Or install it directly:

```bash
npm run install:backup-cron
```

## Required Env

`BOT_TOKEN`, `DATABASE_URL`, `ADMIN_TELEGRAM_ID`, `WEBAPP_URL`

Production should also keep `ALLOW_DEV_AUTH=false`.

For backup delivery:

`BACKUP_DIR`, `BACKUP_FILE_PREFIX`, `BACKUP_RETENTION_COUNT`

Optional for large dumps:

`TELEGRAM_BOT_API_BASE_URL`, `TELEGRAM_MAX_UPLOAD_MB`, `PG_DUMP_BIN`, `PG_RESTORE_BIN`
