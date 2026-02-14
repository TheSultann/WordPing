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
6. Запусти бота и воркер в двух процессах:
   - `npm run dev:bot`
   - `npm run dev:worker`
   Для продакшена: `npm run build` + `npm run start:bot` и `npm run start:worker`.

## Что делает
- /add — добавление слова (бот предложит перевод из мини-словаря, иначе попросит ввести вручную).
- Лимит на добавление слов: по умолчанию 9 слов в день на пользователя. Для ID из `UNLIMITED_WORD_ADD_IDS` (или `ADMIN_USER_IDS`) лимит отключён.
- Уведомления идут по nextReviewAt (UTC в БД), направление карточек выбирается 50/50 EN↔RU.
- Проверка ответов без учёта регистра и лишних пробелов, для RU→EN принимаются варианты с артиклями.
- Оценки Hard/Good/Easy двигают по фиксированной лестнице интервалов: 5 мин → 25 мин → 2 ч → 1 д → 3 д → 7 д → 16 д → 35 д.
  - Hard: шаг назад по лестнице.
  - Good: шаг вперёд.
  - Easy: если стадия ≤2 — прыжок сразу на 3 дня, иначе +2 стадии.
- Напоминания: +5 мин и +20 мин, затем пропуск (слово возвращается через 1 час, stage 0).
- Стрик по дням: если за день выполнено 3 задания — стрик растёт, пропущенный день сбрасывает.
- Настройки и статистика доступны в Mini App: команды /settings и /stats открывают Web-приложение (кнопка открывается, если задан WEBAPP_URL).

## Структура
- src/bot — обработчики команд и FSM.
- src/scheduler — крон-воркер (каждую минуту рассылает задания и напоминания).
- src/services — логика SRS, проверки ответов, работа с пользователями/сессиями.
- src/db — Prisma client.
- prisma/ — схема и миграции (prisma/migrations/0001_init).

## Хранение
- Времена в БД — UTC.
- Пользовательские окна уведомлений в минутах от 00:00 (по умолчанию 08:00–23:00). При проверке используется timezone пользователя (если не задан — UTC).

## Полезные команды
- `npm run migrate:dev` — prisma migrate dev.
- `npm run migrate:deploy` — применить миграции в проде.
- `npm run prisma:generate` — пересоздать клиент.

Логи пишутся в stdout/stderr (Telegraf и воркер).

## Mini App (Web) и API
Локальный запуск:
1. Установи зависимости веб-приложения:
   - `npm --prefix web install`
2. Запусти API:
   - `npm run dev:api`
3. Запусти Web App:
   - `npm run dev:web`
4. Для реферальных ссылок укажи `VITE_BOT_USERNAME` в `web/.env`.
5. Укажи `WEBAPP_URL` в `.env`, чтобы бот отправлял кнопку открытия приложения.
6. Для локального теста без Telegram включи `ALLOW_DEV_AUTH=true` и используй `?devUserId=123`.
7. Авторизация Mini App: API принимает `x-telegram-init-data` (из Telegram WebApp) или `x-dev-user-id` для дев-режима.

Если открываешь Web App не внутри Telegram, можно передать `?devUserId=123456789`.
Для продакшена укажи `WEB_ORIGIN` и настрой HTTPS-домен.

## Автоперевод
Бот подставляет перевод слова через цепочку fallback:
1. Hugging Face Inference API (Helsinki-NLP MarianMT)
2. Gemini API
3. MyMemory API

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

## Тесты
Юнит + интеграционные тесты:
- `npm run test`

Интеграционные тесты используют Postgres и по умолчанию создают схему `test`
в базе из `DATABASE_URL`. Если нужно, можно задать отдельную БД через
`TEST_DATABASE_URL`.
