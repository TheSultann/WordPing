import { trimEnv } from '../../utils/env';

export const NEWS_STAGE_THRESHOLD = 4;
export const DEFAULT_RESOLVE_BATCH = 20;
export const DEFAULT_NEEDS_RESOLVE_SCAN_LIMIT = 100;
export const DEFAULT_NEWS_MAX_JOB_ATTEMPTS = 5;
export const DEFAULT_NEWS_RETRY_BASE_MINUTES = 15;
export const DEFAULT_NEWS_RETRY_MAX_MINUTES = 120;
export const DEFAULT_NEWS_JOB_RETENTION_DAYS = 14;
export const DEFAULT_NEWS_EXHAUSTED_RETRY_HOURS = 24;
export const DEFAULT_RSS_FETCH_TIMEOUT_MS = 7000;
export const DEFAULT_GDELT_TIMEOUT_MS = 7000;
export const DEFAULT_GUARDIAN_TIMEOUT_MS = 7000;
export const DEFAULT_NEWDATA_TIMEOUT_MS = 7000;
export const DEFAULT_NEWS_CACHE_TTL_DAYS = 7;
export const DEFAULT_RSS_ITEM_LIMIT_PER_FEED = 80;
export const DEFAULT_RSS_FAST_STAGE_LIMIT = 80;
export const DEFAULT_RSS_BODY_STAGE_LIMIT = 40;
export const DEFAULT_RSS_MATCH_MIN_SCORE = 55;
export const DEFAULT_RSS_TOKEN_COVERAGE_MIN = 0.8;
export const DEFAULT_GDELT_ARTICLE_LIMIT = 25;
export const DEFAULT_GUARDIAN_PAGE_SIZE = 20;
export const DEFAULT_NEWDATA_DAILY_LIMIT = 200;
export const DEFAULT_NEWDATA_DAILY_BUDGET = 120;
export const DEFAULT_NEWDATA_WORD_RETRY_HOURS = 12;
export const DEFAULT_GDELT_WORD_RETRY_HOURS = 24;
export const DEFAULT_GDELT_MIN_INTERVAL_SECONDS = 10;
export const DEFAULT_GDELT_COOLDOWN_MINUTES = 30;
export const DEFAULT_GUARDIAN_SKIP_WITHOUT_KEY = true;
export const DEFAULT_NEWS_NOT_FOUND_RETRY_HOURS = 12;
export const DEFAULT_NEWS_NOT_FOUND_RETRY_STEPS_MINUTES = [30, 120, 360, 720, 1440];
export const DEFAULT_NEWS_STALE_DAYS = 2;
export const DEFAULT_NEWS_MARK_OLD_CRON = '15 2 * * *';
export const DEFAULT_NEWS_METRICS_CRON = '0 * * * *';
export const DEFAULT_NEWS_SOURCE_LINK_CHECK_CRON = '45 * * * *';
export const DEFAULT_NEWS_SOURCE_LINK_CHECK_BATCH = 30;
export const DEFAULT_NEWS_SOURCE_LINK_TIMEOUT_MS = 5000;

const DEFAULT_GDELT_API_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const DEFAULT_GUARDIAN_API_URL = 'https://content.guardianapis.com/search';
const DEFAULT_NEWDATA_API_URL = 'https://newsdata.io/api/1/latest';
const DEFAULT_GDELT_QUERY_SCOPE = 'Uzbekistan';
const DEFAULT_RSS_FEEDS = [
    'https://www.gazeta.uz/en/rss/',
    'https://kun.uz/en/news/rss',
    'https://uzdaily.uz/en/rss',
];
const DEFAULT_RSS_PRIMARY_DOMAINS = [
    'gazeta.uz',
    'kun.uz',
    'uzdaily.uz',
];

export const readPositiveInt = (raw: string | undefined, fallback: number, min: number, max: number): number => {
    const parsed = Number.parseInt(trimEnv(raw), 10);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
    return parsed;
};

export const readRssFeeds = (): string[] => {
    const configured = trimEnv(process.env.NEWS_RSS_FEEDS);
    const feeds = configured
        ? configured.split(',').map((item) => item.trim()).filter(Boolean)
        : DEFAULT_RSS_FEEDS;
    return Array.from(new Set(feeds));
};

export const readRssPrimaryDomains = (): string[] => {
    const configured = trimEnv(process.env.NEWS_RSS_PRIMARY_DOMAINS);
    const domains = configured
        ? configured.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
        : DEFAULT_RSS_PRIMARY_DOMAINS;
    return Array.from(new Set(domains));
};

export const readNewsCacheTtlDays = (): number =>
    readPositiveInt(process.env.NEWS_CACHE_TTL_DAYS, DEFAULT_NEWS_CACHE_TTL_DAYS, 1, 30);

export const readRssTimeoutMs = (): number =>
    readPositiveInt(process.env.NEWS_RSS_TIMEOUT_MS, DEFAULT_RSS_FETCH_TIMEOUT_MS, 1000, 30000);

export const readGdeltTimeoutMs = (): number =>
    readPositiveInt(process.env.NEWS_GDELT_TIMEOUT_MS, DEFAULT_GDELT_TIMEOUT_MS, 1000, 30000);

export const readGdeltArticleLimit = (): number =>
    readPositiveInt(process.env.NEWS_GDELT_MAX_RECORDS, DEFAULT_GDELT_ARTICLE_LIMIT, 1, 100);

export const readGuardianTimeoutMs = (): number =>
    readPositiveInt(process.env.NEWS_GUARDIAN_TIMEOUT_MS, DEFAULT_GUARDIAN_TIMEOUT_MS, 1000, 30000);

export const readGuardianPageSize = (): number =>
    readPositiveInt(process.env.NEWS_GUARDIAN_PAGE_SIZE, DEFAULT_GUARDIAN_PAGE_SIZE, 1, 50);

export const readNewsDataTimeoutMs = (): number =>
    readPositiveInt(process.env.NEWS_NEWDATA_TIMEOUT_MS, DEFAULT_NEWDATA_TIMEOUT_MS, 1000, 30000);

export const readNewsDataDailyLimit = (): number =>
    readPositiveInt(process.env.NEWS_NEWDATA_DAILY_LIMIT, DEFAULT_NEWDATA_DAILY_LIMIT, 1, 10000);

export const readNewsDataDailyBudget = (): number =>
    readPositiveInt(process.env.NEWS_NEWDATA_DAILY_BUDGET, DEFAULT_NEWDATA_DAILY_BUDGET, 1, 10000);

export const readNewsDataWordRetryHours = (): number =>
    readPositiveInt(process.env.NEWS_NEWDATA_WORD_RETRY_HOURS, DEFAULT_NEWDATA_WORD_RETRY_HOURS, 1, 168);

export const readGdeltWordRetryHours = (): number =>
    readPositiveInt(process.env.NEWS_GDELT_WORD_RETRY_HOURS, DEFAULT_GDELT_WORD_RETRY_HOURS, 1, 168);

export const readGdeltMinIntervalSeconds = (): number =>
    readPositiveInt(process.env.NEWS_GDELT_MIN_INTERVAL_SECONDS, DEFAULT_GDELT_MIN_INTERVAL_SECONDS, 1, 120);

export const readGdeltCooldownMinutes = (): number =>
    readPositiveInt(process.env.NEWS_GDELT_COOLDOWN_MINUTES, DEFAULT_GDELT_COOLDOWN_MINUTES, 1, 720);

export const readGuardianSkipWithoutKey = (): boolean => {
    const raw = trimEnv(process.env.NEWS_GUARDIAN_SKIP_WITHOUT_KEY).toLowerCase();
    if (!raw) return DEFAULT_GUARDIAN_SKIP_WITHOUT_KEY;
    return !['0', 'false', 'no', 'off'].includes(raw);
};

export const readRssItemLimit = (): number =>
    readPositiveInt(process.env.NEWS_RSS_MAX_ITEMS_PER_FEED, DEFAULT_RSS_ITEM_LIMIT_PER_FEED, 1, 200);

export const readRssFastStageLimit = (): number =>
    readPositiveInt(process.env.NEWS_RSS_FAST_STAGE_LIMIT, DEFAULT_RSS_FAST_STAGE_LIMIT, 10, 300);

export const readRssBodyStageLimit = (): number =>
    readPositiveInt(process.env.NEWS_RSS_BODY_STAGE_LIMIT, DEFAULT_RSS_BODY_STAGE_LIMIT, 10, 300);

export const readRssMatchMinScore = (): number => {
    const raw = Number.parseFloat(trimEnv(process.env.NEWS_RSS_MATCH_MIN_SCORE));
    if (!Number.isFinite(raw)) return DEFAULT_RSS_MATCH_MIN_SCORE;
    return Math.min(200, Math.max(1, raw));
};

export const readRssTokenCoverageMin = (): number => {
    const raw = Number.parseFloat(trimEnv(process.env.NEWS_RSS_TOKEN_COVERAGE_MIN));
    if (!Number.isFinite(raw)) return DEFAULT_RSS_TOKEN_COVERAGE_MIN;
    return Math.min(1, Math.max(0.1, raw));
};

export const readNewsNotFoundRetryHours = (): number =>
    readPositiveInt(process.env.NEWS_NOT_FOUND_RETRY_HOURS, DEFAULT_NEWS_NOT_FOUND_RETRY_HOURS, 1, 168);

export const readNewsNotFoundRetryStepsMinutes = (): number[] => {
    const rawSteps = trimEnv(process.env.NEWS_NOT_FOUND_RETRY_STEPS_MINUTES);
    if (rawSteps) {
        const parsed = rawSteps
            .split(',')
            .map((item) => Number.parseInt(item.trim(), 10))
            .filter((item) => Number.isFinite(item) && item >= 1 && item <= 10080);
        if (parsed.length) {
            return parsed;
        }
    }

    const hasLegacyHours = Boolean(trimEnv(process.env.NEWS_NOT_FOUND_RETRY_HOURS));
    if (hasLegacyHours) {
        return [readNewsNotFoundRetryHours() * 60];
    }

    return DEFAULT_NEWS_NOT_FOUND_RETRY_STEPS_MINUTES;
};

export const readNewsMaxJobAttempts = (): number =>
    readPositiveInt(process.env.NEWS_MAX_JOB_ATTEMPTS, DEFAULT_NEWS_MAX_JOB_ATTEMPTS, 1, 100);

export const readNewsRetryBaseMinutes = (): number =>
    readPositiveInt(process.env.NEWS_RETRY_BASE_MINUTES, DEFAULT_NEWS_RETRY_BASE_MINUTES, 1, 240);

export const readNewsRetryMaxMinutes = (): number =>
    readPositiveInt(process.env.NEWS_RETRY_MAX_MINUTES, DEFAULT_NEWS_RETRY_MAX_MINUTES, 5, 1440);

export const readNewsJobRetentionDays = (): number =>
    readPositiveInt(process.env.NEWS_JOB_RETENTION_DAYS, DEFAULT_NEWS_JOB_RETENTION_DAYS, 1, 90);

export const readNewsExhaustedRetryHours = (): number =>
    readPositiveInt(process.env.NEWS_EXHAUSTED_RETRY_HOURS, DEFAULT_NEWS_EXHAUSTED_RETRY_HOURS, 1, 168);

export const readNewsStaleDays = (): number =>
    readPositiveInt(process.env.NEWS_STALE_DAYS, DEFAULT_NEWS_STALE_DAYS, 1, 30);

export const readMarkOldCron = (): string =>
    trimEnv(process.env.NEWS_MARK_OLD_CRON) || DEFAULT_NEWS_MARK_OLD_CRON;

export const readMetricsCron = (): string =>
    trimEnv(process.env.NEWS_METRICS_CRON) || DEFAULT_NEWS_METRICS_CRON;

export const readSourceLinkCheckCron = (): string =>
    trimEnv(process.env.NEWS_SOURCE_LINK_CHECK_CRON) || DEFAULT_NEWS_SOURCE_LINK_CHECK_CRON;

export const readSourceLinkCheckBatch = (): number =>
    readPositiveInt(process.env.NEWS_SOURCE_LINK_CHECK_BATCH, DEFAULT_NEWS_SOURCE_LINK_CHECK_BATCH, 1, 500);

export const readSourceLinkTimeoutMs = (): number =>
    readPositiveInt(process.env.NEWS_SOURCE_LINK_TIMEOUT_MS, DEFAULT_NEWS_SOURCE_LINK_TIMEOUT_MS, 1000, 30000);

export const gdeltApiUrl = (): string => trimEnv(process.env.GDELT_API_URL) || DEFAULT_GDELT_API_URL;
export const guardianApiUrl = (): string => trimEnv(process.env.GUARDIAN_API_URL) || DEFAULT_GUARDIAN_API_URL;
export const guardianApiKey = (): string => trimEnv(process.env.GUARDIAN_API_KEY) || 'test';
export const newsDataApiUrl = (): string => trimEnv(process.env.NEWDATA_API_URL) || DEFAULT_NEWDATA_API_URL;
export const newsDataApiKey = (): string => trimEnv(process.env.NEWDATA_API_KEY);
export const gdeltQueryScope = (): string => trimEnv(process.env.GDELT_QUERY_SCOPE) || DEFAULT_GDELT_QUERY_SCOPE;
