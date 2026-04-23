   # WordPing — Telegram бот для интервальных повторений

   ## Быстрый старт
   1. Node.js  и PostgreSQL.
   2. Установи зависимости:
      - `npm install`
   3. Скопируй .env.example в .env и задай:
      - BOT_TOKEN — токен бота от BotFather.
      - DATABASE_URL — строка подключения Postgres (можно Supabase).
   4. Сгенерируй клиент:
      - `npx prisma generate`
   5. Прогоняй миграции:
      - `npx prisma migrate deploy` (или `npx prisma migrate dev --name init`)
   6. Запусти процессы:
      - `npm run dev:bot`
      - `npm run dev:worker`
      - `npm run dev:news-worker`
      Для продакшена: `npm run build` + `npm run start:bot`, `npm run start:worker`, `npm run start:news-worker`.
   7. Для сервера без Docker используй `pm2`:
      - `npm i -g pm2`
      - `npm run build`
      - `npm run pm2:start`

   ## Что делает
   - /add — добавление слова (бот определяет язык ввода и предлагает автоперевод; при сомнительном результате просит ввести перевод вручную).
   - Лимит на добавление слов: по умолчанию 9 слов в день на пользователя. Для ID из `UNLIMITED_WORD_ADD_IDS` (или `ADMIN_USER_IDS`) лимит отключён.
   - Для каждого слова создаются две независимые карточки повторения: `EN -> native` и `native -> EN` (native = RU/UZ в зависимости от языка пользователя).
   - Уведомления идут по `nextReviewAt` (UTC в БД).
   - Проверка ответов без учёта регистра и лишних пробелов; для направления `native -> EN` принимаются варианты с артиклями.
   - Оценки Hard/Good/Easy двигают по фиксированной лестнице интервалов: 5 мин → 25 мин → 1.5 ч → 20 ч → 2.5 д → 6 д → 14 д → 30 д.
   - Hard: шаг назад по лестнице.
   - Good: шаг вперёд.
   - Easy: +2 стадии (с ограничением на максимум лестницы).
   - Напоминания: +5 мин и +20 мин, затем пропуск (слово возвращается через 1 час, stage 0).
   - Стрик по дням: если за день выполнено 3 задания — стрик растёт, пропущенный день сбрасывает.
   - Настройки и статистика доступны в Mini App: команды /settings и /stats открывают Web-приложение (кнопка открывается, если задан WEBAPP_URL).

   ## Контекстное изучение (Sentence-Based Learning)
   - На начальных стадиях (Stage 0-1) бот запрашивает перевод изолированного слова («Простой перевод»).
   - На продвинутых стадиях (Stage 2+) бот использует контекст — короткие фразы на английском языке (сгенерированные через Gemini API):
   - **Stage 2-6**: целевое слово выделено в предложении (учим применять в контексте).
   - **Stage 7+**: целевое слово заменено на `___` (тренируем вспоминание по смыслу).
   - В направлении `native -> EN` показывается только native-контекст (без утечки английского ответа).
   - **Ротация примеров**: Для каждого слова ИИ генерирует 3 разных предложения. При каждом повторении пример меняется, чтобы вы не заучивали одну и ту же фразу.
   - **Кнопка 🔄**: Если сгенерированный пример оказался неудачным, прямо из карточки можно нажать 🔄 (заменит на другой пример, лимит: 1 раз в сутки для каждого слова).
   - **Фоновая генерация**: Примеры создаются асинхронно при сохранении слова. Незаполненные примеры добираются автоматически фоновым cron-процессом `worker` каждые 30 минут.

   ## 🧠 Quiz: как выбираются слова
   - Quiz всегда идёт короткой сессией на `10` вопросов, а не по всему словарю пользователя.
   - В Quiz попадают только слова, где есть карточка со `stage >= 2`.
   - Отбор не случайный. Для каждого слова считается приоритет:
   - выше, если пользователь недавно ошибался;
   - выше, если есть `hardStreak`;
   - выше, если слово давно не показывалось или уже overdue по review;
   - ниже, если это слово только что было в недавнем Quiz;
   - ниже, если по этому слову уже было несколько лёгких/успешных ответов подряд.
   - Это даёт ротацию: при словаре в `100-200` слов пользователь получает маленькую полезную сессию, а не перегруз из всех слов сразу.
   - Вопросы бывают трёх типов: `multiple choice`, `true/false`, `context`.
   - Для контекстного вопроса бот показывает само предложение с выделенным словом и прямой вопрос по смыслу, без `___`.

   ## 📰 Новости: как работает от и до
   ### Что видит пользователь
   1. В главном меню есть кнопка `📰 Почитать новости`.
   2. По нажатию бот не ходит во внешние API, а читает только готовые данные из БД.
   3. Бот показывает дайджест батчами по 5 карточек (слова пользователя, где есть готовый новостной пример и `stage >= 4`).
      Если пользователь нажимает `Ещё`, открывается следующая пятёрка.
      Это не просто список всех слов подряд: сначала выбираются самые полезные карточки на сейчас.
   4. Слово подсвечивается жирным/подчёркнутым, для внешних источников показывается кнопка `🔗 Читать оригинал`.
   5. Если исходная ссылка уже мертва (`404/410`), бот показывает `sourceTitle` без ссылки и автоматически ставит слово на refresh.
   6. Если готовых примеров нет: бот пишет `📰 Пока нет готовых новостных примеров. Попробуйте чуть позже.`

   ### Почему ответ быстрый
   - Все тяжелые запросы идут только в `news-worker`.
   - Кнопка в боте делает только чтение из БД (precomputed данные).

   ### Когда слово попадает в новости
   - Новостная подготовка включается для слов, у которых хотя бы одно направление повторения достигло `stage >= 4`.
   - Для таких слов создается/обновляется задача в `NewsResolveJob`.

   ### Как выбираются карточки в дайджест
   - В выдачу попадают только слова с уже готовым `newsExampleText` и `stage >= 4`.
   - Дальше карточки сортируются по полезности:
   - выше свежие примеры;
   - выше слова с более сильным `stage`;
   - выше более качественные источники (`tier`);
   - ниже слова, которые пользователь совсем недавно видел в Quiz.
   - Поэтому дайджест не вываливает весь архив сразу и старается не повторять только что отработанные слова.

   ### Фоновая цепочка fallback
   Порядок поиска примера:
   1. `Tier1: RSS cache (NewsCache)`  
      Поиск по локальному кэшу (title/snippet/bodyText) с формами слова и скорингом.
   2. `Tier2: NewsData.io`  
      Сначала `Uzbekistan + en`, если пусто — `global + en`.
   3. `Tier3: GDELT`  
      Ограниченный fallback с rate-limit и cooldown.
   4. `Tier4: Guardian`  
      Используется только при валидном `GUARDIAN_API_KEY`.

   ### Ограничения и защита от лимитов
   - `NewsData`: дневной бюджет запросов, хранится в БД (`NewsProviderState`).
   - `GDELT`: минимум интервал между запросами + cooldown при `429`.
   - `Guardian`: если ключ пустой или `test`, запросы пропускаются.
   - Состояние провайдеров и лимитов хранится в `NewsProviderState`.

   ### Cron в news-worker
   - `0 * * * *` — обновить RSS-кэш.
   - `0 * * * *` — поставить задачи в очередь (и rearm exhausted jobs).
   - `*/5 * * * *` — резолвить pending jobs.
   - `15 2 * * *` — пометить устаревшие примеры на refresh.
   - `0 * * * *` — снять hourly metrics snapshot.
   - `45 * * * *` — проверить живость `newsExampleSourceUrl` (битые `404/410` пометить на refresh и переочередить).
   - `20 3 * * *` — очистка старого кэша/задач.

   ### Важное правило архитектуры
   - `src/scheduler/worker.ts` (основной UVD cron) не делает внешние запросы новостей.
   - Внешние news API вызываются только из `src/scheduler/newsWorker.ts` через `newsFallbackService`.

   ## Структура
   - src/bot — обработчики команд и FSM.
   - src/scheduler/worker.ts — основной UVD воркер (карточки/напоминания).
   - src/scheduler/newsWorker.ts — отдельный news воркер (RSS + news fallback).
   - src/services — логика SRS, проверки ответов, пользователи/сессии, news fallback.
   - src/db — Prisma client.
   - prisma/ — схема и миграции (prisma/migrations/0001_init).

   ## Хранение
   - Времена в БД — UTC.
   - Пользовательские окна уведомлений в минутах от 00:00 (по умолчанию 08:00–23:00). При проверке используется timezone пользователя (если не задан — UTC).

   ## Полезные команды
   - `npm run migrate:dev` — prisma migrate dev.
   - `npm run migrate:deploy` — применить миграции в проде.
   - `npm run prisma:generate` — пересоздать клиент.
   - `npm run dev:news-worker` — локально запустить news worker.
   - `npm run start:news-worker` — прод запуск news worker (из `dist`).
   - `npm run pm2:start` — поднять все 4 prod процесса через `pm2`.
   - `npm run pm2:restart` — перезапустить все 4 процесса.
   - `npm run pm2:stop` — остановить все 4 процесса.
   - `npm run pm2:delete` — удалить процессы из `pm2`.
   - `npm run pm2:logs` — смотреть логи.
   - `npm run backup:db` — сделать backup Postgres.
   - `npm run restore:db -- ./backups/postgres/<file>.dump` — восстановить backup.
   - Путь проекта на AWS-сервере (текущий): `~/apps/WordPing`.

   Логи пишутся в stdout/stderr (bot, worker, news-worker, api).
   - Локально формат по умолчанию: `pretty`.
   - В проде через `pm2`: `json`.
   - Можно задать:
   - `LOG_LEVEL=debug|info|warn|error`
   - `LOG_FORMAT=pretty|json`
   - У API есть `x-request-id`, он попадает в логи запросов.

   Healthcheck:
   - `GET /api/health` — статус API, БД и heartbeat всех 4 backend-процессов.

   ## Backup БД
   - Backup делается через `pg_dump` в формате `.dump`.
   - По умолчанию файлы кладутся в `./backups/postgres`.
   - Скрипт сам держит только последние `14` backup-файлов.
   - После backup скрипт отправляет `.dump` тебе в личку через Telegram бота.
   - Если файл не влезает в лимит Telegram upload, скрипт не молчит: шлёт warning в личку и завершает команду ошибкой.
   - Для восстановления используется `pg_restore`.

   Что нужно на сервере:
   - `DATABASE_URL`
   - `BOT_TOKEN`
   - `ADMIN_TELEGRAM_ID`
   - `pg_dump`
   - `pg_restore`

   Переменные:
   - `BACKUP_DIR` — куда складывать backup.
   - `BACKUP_FILE_PREFIX` — префикс имени файла.
   - `BACKUP_RETENTION_COUNT` — сколько последних backup хранить.
   - `ADMIN_TELEGRAM_ID` — твой Telegram ID, куда текущий бот отправит файл.
   - `TELEGRAM_BOT_API_BASE_URL` — base URL Bot API. По умолчанию `https://api.telegram.org`.
   - `TELEGRAM_MAX_UPLOAD_MB` — явный upload limit в MB. Если не задан:
   - для cloud Bot API берётся `50 MB`;
   - для local Bot API server — `2000 MB`.
   - `PG_DUMP_BIN` / `PG_RESTORE_BIN` — если бинарники лежат не в `PATH`.

   Ручной запуск:
   ```bash
   npm run backup:db
   ```

   Восстановление:
   ```bash
   npm run restore:db -- ./backups/postgres/wordping-db-20260319T172700Z.dump
   ```

   Пример nightly cron:
   ```bash
   0 3 * * * cd ~/apps/WordPing && /usr/bin/npm run backup:db >> ~/apps/WordPing/backups/backup.log 2>&1
   ```

   Быстрая установка на сервере:
   ```bash
   npm run install:backup-cron
   ```

   Рекомендация для больших баз:
   - если `.dump` начинает приближаться к `50 MB`, подними local Bot API server и укажи `TELEGRAM_BOT_API_BASE_URL`;
   - иначе backup локально создастся, но upload в Telegram будет остановлен предиктивно.

   ## Обновление сервера (prod)
   Первый запуск через `pm2`:
   1. Установить `pm2`:
      - `npm i -g pm2`
   2. Перейти в проект:
      - `cd ~/apps/WordPing`
   3. Установить зависимости:
      - `npm ci`
   4. Применить миграции и собрать проект:
      - `npx prisma migrate deploy`
      - `npx prisma generate`
      - `npm run build`
      - `npm run build:web`
      - `sudo rsync -av --delete ~/apps/WordPing/web/dist/ /var/www/wordping/`
      - `sudo systemctl reload nginx`
   5. Поднять все процессы:
      - `npm run pm2:start`
   6. Сохранить список процессов:
      - `pm2 save`

   Порядок обновления:
   1. Перейти в проект:
      - `cd ~/apps/WordPing`
   2. Проверить, что нет локальных правок:
      - `git status --short`
   3. Подтянуть код:
      - `git pull --rebase`
   4. Обновить зависимости:
      - `npm ci`
   5. Применить миграции:
      - `npx prisma migrate deploy`
   6. Пересобрать Prisma Client:
      - `npx prisma generate`
   7. Собрать backend и web:
      - `npm run build`
      - `npm run build:web`
   8. Обновить статику Mini App в `nginx`:
      - `sudo rsync -av --delete ~/apps/WordPing/web/dist/ /var/www/wordping/`
      - `sudo systemctl reload nginx`
   9. Перезапустить процессы:
      - `npm run pm2:restart`
   10. Очистить и проверить логи:
      - `pm2 flush`
      - `pm2 logs wordping-worker --lines 60`
      - `pm2 logs wordping-news-worker --lines 60`
      - `pm2 logs wordping-bot --lines 40`
      - `pm2 logs wordping-api --lines 40`
   11. Проверить health и фронт:
      - `curl http://localhost:3001/api/health`
      - `curl -I https://wordping.duckdns.org`

   Короткий блок копипастой:
   ```bash
   cd ~/apps/WordPing
   git status --short
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
   pm2 flush
   pm2 logs wordping-worker --lines 60
   pm2 logs wordping-news-worker --lines 60
   ```

   ## Если `git pull` задаёт вопросы
   Частые случаи и что делать:

   1. `Please commit your changes or stash them before you merge`
      - На сервере есть локальные правки. Сохрани их:
      - `git stash push -u -m "server-temp-before-sync"`
      - Потом снова:
      - `git pull --rebase`

   2. Конфликты при `pull --rebase` (`CONFLICT`)
      - Посмотреть файлы:
      - `git status`
      - После исправления:
      - `git add <файл>`
      - `git rebase --continue`
      - Если нужно отменить:
      - `git rebase --abort`

   3. Открылся редактор (vim/nano) и ждёт сообщение
      - Обычно это merge/rebase commit message.
      - Для `vim`: `Esc`, потом `:wq`, Enter.
      - Для `nano`: `Ctrl+O`, Enter, `Ctrl+X`.

   4. Хочешь избегать лишних вопросов от `git pull`
      - Один раз на сервере:
      - `git config pull.rebase true`
      - `git config rebase.autoStash true`
      - Тогда обычный `git pull` будет вести себя предсказуемо.

   ## Mini App (Web) и API
   Локальный запуск:
   1. Установи зависимости веб-приложения:
      - `npm --prefix web install`
   2. Запусти API:
      - `npm run dev:api`
   3. Запусти Web App:
      - `npm run dev:web`
   4. Для ссылок `t.me/<bot>/app` укажи `BOT_USERNAME` в корневом `.env`.
      Для реферальных ссылок укажи `VITE_BOT_USERNAME` в `web/.env`.
      Опционально для мгновенного показа вкладки админа укажи `VITE_ADMIN_TELEGRAM_ID`.
   5. Укажи `WEBAPP_URL` в `.env`, чтобы бот отправлял кнопку открытия приложения.
   6. Для локального теста без Telegram включи `ALLOW_DEV_AUTH=true` и используй `?devUserId=123`.
      На продакшене держи `ALLOW_DEV_AUTH=false`.
   7. Авторизация Mini App: API принимает `x-telegram-init-data` (из Telegram WebApp) или `x-dev-user-id` для дев-режима.

   Если открываешь Web App не внутри Telegram, можно передать `?devUserId=123456789`.
   Для продакшена укажи `WEB_ORIGIN` и настрой HTTPS-домен.
   Если фронт и API на одном AWS-сервере, настрой reverse proxy: `https://your-domain/api/* -> http://127.0.0.1:3001/api/*`.
   В текущем проде Mini App статика раздается `nginx` из `/var/www/wordping`, поэтому после `npm run build:web` нужно синхронизировать `~/apps/WordPing/web/dist/` в `/var/www/wordping/` и делать `sudo systemctl reload nginx`, иначе домен может продолжать отдавать старую версию фронта.

   ## Автоперевод
   Бот подставляет перевод слова через цепочку fallback:
   1. Gemini API
   2. Hugging Face Inference API (Helsinki-NLP MarianMT)
   3. MyMemory API

   Дополнительно:
   - Есть дневная квота автоперевода (по умолчанию `DAILY_AUTO_TRANSLATE_LIMIT=30`, с исключениями для unlimited/admin ID).
   - При исчерпании квоты бот продолжает работать через MyMemory fallback и предупреждает о возможном падении качества.

   Основные переменные:
   - `TRANSLATE_API_TIMEOUT_MS=5000`
   - `TRANSLATE_CACHE_MAX=2000`
   - `HF_API_KEY`, `HF_INFERENCE_BASE_URL`
   - `HF_MODEL_RU_EN=Helsinki-NLP/opus-mt-ru-en`
   - `HF_MODEL_EN_RU=Helsinki-NLP/opus-mt-en-ru`
   - `HF_MODEL_UZ_EN=Helsinki-NLP/opus-mt-uz-en`
   - `HF_MODEL_EN_UZ=Helsinki-NLP/opus-mt-en-uz`
   - `GEMINI_API_KEY`, `GEMINI_API_BASE_URL`
   - `GEMINI_MODEL=gemini-2.5-flash-lite`
   - `GEMINI_FALLBACK_MODELS=gemini-2.5-flash,gemini-2.0-flash-lite`
   - `TRANSLATE_API_URL=https://api.mymemory.translated.net/get`

   Логика маршрутизации:
   - Язык входа определяется автоматически (`ru`, `en`, `uz`).
   - Для `ru <-> uz` используется двойной маршрут через английский:
   - `uz -> en -> ru`
   - `ru -> en -> uz`
   - Повторные запросы берутся из in-memory кеша.

   ## Новости: ENV переменные
   Основные:
   - `NEWS_RSS_FEEDS` — RSS источники через запятую.
   - `NEWS_RSS_PRIMARY_DOMAINS` — домены приоритетных источников.
   - `NEWS_CACHE_TTL_DAYS` — TTL новостей в кэше.
   - `NEWS_RSS_TIMEOUT_MS` — timeout загрузки одного RSS feed.
   - `NEWS_RSS_MAX_ITEMS_PER_FEED` — максимум элементов на один feed за проход.
   - `NEWS_RSS_MATCH_MIN_SCORE` — минимальный score матчинга слова в RSS-кэше.
   - `NEWS_RSS_TOKEN_COVERAGE_MIN` — минимальное покрытие токенов для multi-word матчинга.
   - `NEWS_RSS_REFRESH_CRON`, `NEWS_ENQUEUE_CRON`, `NEWS_RESOLVE_CRON`, `NEWS_PRUNE_CRON` — cron расписание news-worker.
   - `NEWS_MARK_OLD_CRON` — daily cron для пометки устаревших news-примеров (`newsExampleNeedsRefresh=true`).
   - `NEWS_METRICS_CRON` — hourly cron для snapshot-метрик очереди/кэша.
   - `NEWS_SOURCE_LINK_CHECK_CRON` — cron для проверки живости `newsExampleSourceUrl`.
   - `NEWS_SOURCE_LINK_CHECK_BATCH` — сколько ссылок проверять за один проход.
   - `NEWS_SOURCE_LINK_TIMEOUT_MS` — timeout проверки одной ссылки.
   - `NEWS_STALE_DAYS` — через сколько дней считать пример устаревшим (по умолчанию `2`).
   - `NEWS_NOT_FOUND_RETRY_STEPS_MINUTES` — ступени ретрая для `news_not_found` в минутах (например `30,120,360,720,1440`).
   - `NEWS_NOT_FOUND_RETRY_HOURS` — legacy fallback, если `NEWS_NOT_FOUND_RETRY_STEPS_MINUTES` не задан.
   - `NEWS_MAX_JOB_ATTEMPTS` — лимит попыток на один job до перехода в exhausted-state.
   - `NEWS_EXHAUSTED_RETRY_HOURS` — через сколько часов exhausted-job автоматически rearm в `PENDING`.
   - `NEWS_RETRY_BASE_MINUTES` и `NEWS_RETRY_MAX_MINUTES` — базовый и максимальный backoff для transient ошибок.
   - `NEWS_JOB_RETENTION_DAYS` — сколько дней хранить `DONE/FAILED` jobs до prune.

   NewsData:
   - `NEWSDATA_API_KEY`
   - `NEWSDATA_API_URL` (по умолчанию `https://newsdata.io/api/1/latest`)
   - `NEWS_NEWDATA_TIMEOUT_MS`
   - `NEWS_NEWDATA_DAILY_LIMIT`
   - `NEWS_NEWDATA_DAILY_BUDGET`
   - `NEWS_NEWDATA_WORD_RETRY_HOURS`

   GDELT:
   - `GDELT_API_URL`
   - `GDELT_QUERY_SCOPE`
   - `NEWS_GDELT_TIMEOUT_MS`
   - `NEWS_GDELT_MAX_RECORDS`
   - `NEWS_GDELT_MIN_INTERVAL_SECONDS`
   - `NEWS_GDELT_COOLDOWN_MINUTES`
   - `NEWS_GDELT_WORD_RETRY_HOURS`

   Guardian:
   - `GUARDIAN_API_URL`
   - `GUARDIAN_API_KEY`
   - `NEWS_GUARDIAN_TIMEOUT_MS`
   - `NEWS_GUARDIAN_PAGE_SIZE`
   - `NEWS_GUARDIAN_SKIP_WITHOUT_KEY`

   ## Тесты
   Юнит + интеграционные тесты:
   - `npm run test`

   Интеграционные тесты используют Postgres и по умолчанию создают схему `test`
   в базе из `DATABASE_URL`. Если нужно, можно задать отдельную БД через
   `TEST_DATABASE_URL`.
