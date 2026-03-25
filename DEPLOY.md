## Server Deploy

```bash
cd ~/apps/WordPing
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
npm run build:web
sudo rsync -av --delete ~/apps/WordPing/web/dist/ /var/www/wordping/
sudo systemctl reload nginx
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
npm run build:web
sudo rsync -av --delete ~/apps/WordPing/web/dist/ /var/www/wordping/
sudo systemctl reload nginx
npm run pm2:restart
pm2 save
curl http://localhost:3001/api/health
curl -I https://wordping.duckdns.org
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

For backup delivery:

`BACKUP_DIR`, `BACKUP_FILE_PREFIX`, `BACKUP_RETENTION_COUNT`

Optional for large dumps:

`TELEGRAM_BOT_API_BASE_URL`, `TELEGRAM_MAX_UPLOAD_MB`, `PG_DUMP_BIN`, `PG_RESTORE_BIN`
