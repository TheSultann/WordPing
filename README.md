# WordPing

Telegram-бот и Mini App для интервальных повторений английских слов.

## Быстрый Старт

Требования: Node.js и PostgreSQL.

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate deploy
```

Минимально в `.env` нужны:

- `BOT_TOKEN` - токен Telegram-бота от BotFather.
- `DATABASE_URL` - строка подключения PostgreSQL.

Локальный запуск:

```bash
npm run dev:bot
npm run dev:worker
npm run dev:news-worker
```

Production через PM2:

```bash
npm i -g pm2
npm run build
npm run pm2:start
```

## Основные Возможности

- Добавление слов через `/add` с автоопределением языка и fallback-автопереводом.
- Две карточки на каждое слово: `EN -> native` и `native -> EN`.
- Интервальные повторения по фиксированной лестнице: `5 мин -> 25 мин -> 1.5 ч -> 20 ч -> 2.5 д -> 6 д -> 14 д -> 30 д`.
- Оценки `Hard`, `Good`, `Easy` двигают карточку назад, вперед или на две стадии вперед.
- Напоминания: `+5 мин`, `+20 мин`, затем возврат через `1 час` на `stage 0`.
- Дневной лимит добавления слов: `9` на пользователя; для `UNLIMITED_WORD_ADD_IDS` и `ADMIN_USER_IDS` лимит отключен.
- Настройки и статистика доступны в Mini App через `/settings` и `/stats`, если задан `WEBAPP_URL`.

## Обучение И Quiz

На ранних стадиях бот спрашивает простой перевод. Начиная со `stage >= 2`, использует контекстные фразы, сгенерированные через Gemini API.

- `Stage 0-1`: изолированный перевод.
- `Stage 2-6`: слово выделено в предложении.
- `Stage 7+`: слово заменено на `___`.
- Для одного слова хранится несколько примеров, чтобы не заучивать одну фразу.
- Недостающие примеры добирает фоновый `worker`.

Quiz запускается короткой сессией на `10` вопросов. В него попадают слова со `stage >= 2`. Приоритет выше у слов с недавними ошибками, `hardStreak`, overdue review или давним показом. Типы вопросов: `multiple choice`, `true/false`, `context`.

## Новости

Кнопка `Почитать новости` показывает заранее подготовленные примеры из БД. Бот не ходит во внешние news API в момент нажатия.

News pipeline:

1. Слова со `stage >= 4` попадают в `NewsResolveJob`.
2. `news-worker` ищет примеры через RSS cache, NewsData.io, GDELT и Guardian.
3. Готовые карточки выдаются батчами по 5.
4. Ссылки на источники проверяются; `404/410` помечаются на refresh.

Важное правило: `src/scheduler/worker.ts` не делает внешние news-запросы. Внешние news API вызываются только из `src/scheduler/newsWorker.ts` через `newsFallbackService`.

## Структура Проекта

- `src/bot` - Telegram bot flows и FSM.
- `src/api` - Express API для Mini App и health/readiness endpoints.
- `src/scheduler/worker.ts` - основной worker карточек и напоминаний.
- `src/scheduler/newsWorker.ts` - отдельный news worker.
- `src/services` - SRS, quiz, перевод, пользователи, сессии и news pipeline.
- `src/utils` - общие утилиты.
- `prisma` - Prisma schema и migrations.
- `tests` - Vitest-тесты.
- `web` - React/Vite Mini App.
- `scripts` - backup, restore, deploy, migration и rollback.

## Время И Хранение

- Все времена в БД хранятся в UTC.
- Пользовательские окна уведомлений хранятся в минутах от `00:00`, по умолчанию `08:00-23:00`.
- При проверке окна используется timezone пользователя. Если timezone не задан, используется UTC.

## Полезные Команды

```bash
npm run migrate:dev
npm run migrate:deploy
npm run prisma:generate
npm run dev:news-worker
npm run start:news-worker
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
npm run pm2:logs
npm run backup:db
npm run restore:db -- ./backups/postgres/<file>.dump
```

Текущий путь проекта на AWS-сервере:

```bash
~/apps/WordPing
```

## Mini App И API

Локальный запуск:

```bash
npm --prefix web install
npm run dev:api
npm run dev:web
```

Переменные:

- `BOT_USERNAME` - для ссылок `t.me/<bot>/app`.
- `VITE_BOT_USERNAME` - для реферальных ссылок в `web/.env`.
- `VITE_ADMIN_TELEGRAM_ID` - опционально для показа вкладки админа.
- `WEBAPP_URL` - URL Mini App, который бот отправляет пользователю.
- `WEB_ORIGIN` - production origin для API.
- `ALLOW_DEV_AUTH=true` - локальный dev-режим без Telegram.

В dev-режиме можно открыть Web App с параметром:

```text
?devUserId=123456789
```

Авторизация Mini App:

- `x-telegram-init-data` - Telegram WebApp context.
- `x-dev-user-id` - локальный dev-режим.

В production держи `ALLOW_DEV_AUTH=false`.

Если frontend и API находятся на одном AWS-сервере, настрой reverse proxy:

```text
https://your-domain/api/* -> http://127.0.0.1:3001/api/*
```

Production Mini App статика раздается nginx из `/var/www/wordping`. После `npm run build:web` нужно синхронизировать `web/dist/` в `/var/www/wordping/` и перезагрузить nginx.

## Deploy И Backup

Актуальный production flow описан в `DEPLOY.md`.

Deploy:

```bash
cd ~/apps/WordPing
./scripts/deploy-prod.sh origin/main
```

Если есть Prisma-миграции, сначала запускай migration flow из `DEPLOY.md`, затем application deploy.

Backup создается через `pg_dump` в формате `.dump`, хранится в `./backups/postgres` и отправляется администратору в Telegram. Для восстановления используется `pg_restore`.

Ручной backup:

```bash
npm run backup:db
```

Восстановление:

```bash
npm run restore:db -- ./backups/postgres/<file>.dump
```

Nightly cron:

```bash
0 3 * * * cd ~/apps/WordPing && /usr/bin/npm run backup:db >> ~/apps/WordPing/backups/backup.log 2>&1
```

## Environment

Основные runtime-переменные:

- `BOT_TOKEN`
- `DATABASE_URL`
- `ADMIN_TELEGRAM_ID`
- `WEBAPP_URL`
- `ALLOW_DEV_AUTH=false` в production

Перевод:

- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-2.5-flash-lite`
- `GEMINI_FALLBACK_MODELS=gemini-2.5-flash,gemini-2.0-flash-lite`
- `HF_API_KEY`
- `HF_INFERENCE_BASE_URL`
- `TRANSLATE_API_URL=https://api.mymemory.translated.net/get`
- `DAILY_AUTO_TRANSLATE_LIMIT=30`

Новости:

- `NEWS_RSS_FEEDS`
- `NEWS_RSS_PRIMARY_DOMAINS`
- `NEWSDATA_API_KEY`
- `GDELT_API_URL`
- `GUARDIAN_API_KEY`
- `NEWS_*` cron, retry, timeout и retention настройки

Backup:

- `BACKUP_DIR`
- `BACKUP_FILE_PREFIX`
- `BACKUP_RETENTION_COUNT`
- `TELEGRAM_BOT_API_BASE_URL`
- `TELEGRAM_MAX_UPLOAD_MB`
- `PG_DUMP_BIN`
- `PG_RESTORE_BIN`

Полный список переменных смотри в `.env.example`.

## Логи И Healthcheck

Логи пишутся в `stdout`/`stderr`.

- Локально формат по умолчанию: `pretty`.
- В production через PM2: `json`.
- `LOG_LEVEL`: `debug`, `info`, `warn`, `error`.
- `LOG_FORMAT`: `pretty`, `json`.
- API добавляет `x-request-id` в логи запросов.

Healthcheck:

```http
GET /api/health
```

Endpoint возвращает статус API, БД и heartbeat backend-процессов.

## Тесты

```bash
npm test
```

Интеграционные тесты используют PostgreSQL и по умолчанию создают схему `test` в базе из `DATABASE_URL`. При необходимости можно задать отдельную БД через `TEST_DATABASE_URL`.
