## Server Deploy

```bash
cd ~/apps/WordPing
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
npm run pm2:start
pm2 save
```

## Update

```bash
cd ~/apps/WordPing
git pull --rebase
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
npm run pm2:restart
```

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

For backup delivery:

`BACKUP_DIR`, `BACKUP_FILE_PREFIX`, `BACKUP_RETENTION_COUNT`

Optional for large dumps:

`TELEGRAM_BOT_API_BASE_URL`, `TELEGRAM_MAX_UPLOAD_MB`, `PG_DUMP_BIN`, `PG_RESTORE_BIN`
