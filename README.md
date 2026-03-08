# WordPing — Telegram бот для интервальных повторений

## Быстрый старт
1. Node.js 18+ и PostgreSQL.
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

## 📰 Новости: как работает от и до
### Что видит пользователь
1. В главном меню есть кнопка `📰 Почитать новости`.
2. По нажатию бот не ходит во внешние API, а читает только готовые данные из БД.
3. Бот отправляет до 3 карточек (слова пользователя, где есть готовый новостной пример и `stage >= 4`).
4. Слово подсвечивается жирным/подчёркнутым, для внешних источников показывается кнопка `🔗 Читать оригинал`.
5. Если исходная ссылка уже мертва (`404/410`), бот показывает `sourceTitle` без ссылки и автоматически ставит слово на refresh.
6. Если готовых примеров нет: бот пишет `📰 Пока нет готовых новостных примеров. Попробуйте чуть позже.`

### Почему ответ быстрый
- Все тяжелые запросы идут только в `news-worker`.
- Кнопка в боте делает только чтение из БД (precomputed данные).

### Когда слово попадает в новости
- Новостная подготовка включается для слов, у которых хотя бы одно направление повторения достигло `stage >= 4`.
- Для таких слов создается/обновляется задача в `NewsResolveJob`.

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
- Путь проекта на AWS-сервере (текущий): `~/apps/WordPing`.

Логи пишутся в stdout/stderr (bot, worker, news-worker, api).

## Обновление сервера (prod)
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
7. Собрать проект:
   - `npm run build`
8. Перезапустить процессы:
   - `pm2 restart wordping-api wordping-bot wordping-worker wordping-news-worker --update-env`
   - Если у тебя другие имена процессов в PM2, подставь свои.
9. Очистить и проверить логи:
   - `pm2 flush`
   - `pm2 logs wordping-worker --lines 60`
   - `pm2 logs wordping-news-worker --lines 60`
   - `pm2 logs wordping-bot --lines 40`
   - `pm2 logs wordping-api --lines 40`

Короткий блок копипастой:
```bash
cd ~/apps/WordPing
git status --short
git pull --rebase
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart wordping-api wordping-bot wordping-worker wordping-news-worker --update-env
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
4. Для реферальных ссылок укажи `VITE_BOT_USERNAME` в `web/.env`.
   Опционально для мгновенного показа вкладки админа укажи `VITE_ADMIN_TELEGRAM_ID`.
5. Укажи `WEBAPP_URL` в `.env`, чтобы бот отправлял кнопку открытия приложения.
6. Для локального теста без Telegram включи `ALLOW_DEV_AUTH=true` и используй `?devUserId=123`.
   На продакшене держи `ALLOW_DEV_AUTH=false`.
7. Авторизация Mini App: API принимает `x-telegram-init-data` (из Telegram WebApp) или `x-dev-user-id` для дев-режима.

Если открываешь Web App не внутри Telegram, можно передать `?devUserId=123456789`.
Для продакшена укажи `WEB_ORIGIN` и настрой HTTPS-домен.
Если фронт и API на одном AWS-сервере, настрой reverse proxy: `https://your-domain/api/* -> http://127.0.0.1:3001/api/*`.

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
