import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { Prisma } from '../src/generated/prisma/client';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let prisma: PrismaClient;
let queueWordNewsResolve: (wordId: number) => Promise<void>;
let enqueueWordsNeedingNewsResolve: (limit?: number) => Promise<number>;
let resolvePendingNewsExamples: (limit?: number) => Promise<{
  claimed: number;
  resolved: number;
  failed: number;
  deferred: number;
  durationMs: number;
}>;
let markOldNewsForRefresh: () => Promise<number>;
let markBrokenNewsSourcesForRefresh: (limit?: number) => Promise<number>;
let rearmExhaustedNewsResolveJobs: (limit?: number) => Promise<number>;
let buildUserNewsDigest: (userId: bigint, limit?: number) => Promise<Array<any>>;
let refreshNewsCacheFromRss: () => Promise<{ inserted: number; updated: number; totalProcessed: number }>;
let calculateRetryDate: (attempts: number, reason: string) => Date;

const userId = BigInt(900000401);
const DEFAULT_TEST_RSS_FEEDS = 'https://www.gazeta.uz/en/rss/,https://kun.uz/en/news/rss,https://uzdaily.uz/en/rss';
const TEST_NEWDATA_API = 'https://newsdata.test/api/1/latest';
const TEST_GDELT_API = 'https://gdelt.test/api/v2/doc/doc';

const createStage4Word = async (wordEn: string, translationRu: string, exampleSentence?: string) => {
  const word = await prisma.word.create({
    data: {
      userId,
      wordEn,
      translationRu,
      exampleSentences: exampleSentence
        ? ([{ en: exampleSentence, native: 'test-native' }] as any)
        : Prisma.JsonNull,
      reviews: {
        create: {
          userId,
          direction: 'EN_TO_RU',
          stage: 4,
          intervalMinutes: 3600,
          nextReviewAt: new Date(Date.now() - 1000),
        },
      },
    },
  });
  return word;
};

const seedNews = async (data: {
  title: string;
  snippet: string;
  bodyText?: string | null;
  url?: string;
  publishedAt?: Date | null;
  contentHash: string;
}) => {
  await prisma.newsCache.create({
    data: {
      source: 'kun.uz',
      title: data.title,
      snippet: data.snippet,
      bodyText: data.bodyText ?? null,
      url: data.url ?? `https://kun.uz/en/news/${data.contentHash}`,
      language: 'en',
      publishedAt: data.publishedAt ?? new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      contentHash: data.contentHash,
    },
  });
};

const mockFetchByUrl = (handler: (url: string) => Promise<any>) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    return handler(url);
  });

const mockEmptyExternalNewsProviders = () =>
  mockFetchByUrl(async (url) => {
    if (url.startsWith(TEST_GDELT_API)) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ articles: [] }) } as any;
    }
    if (url.startsWith(TEST_NEWDATA_API)) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success', results: [] }),
      } as any;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ response: { status: 'ok', results: [] } }),
    } as any;
  });

const utcDayStart = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const seedQuizUsage = async (
  items: Array<{
    wordId: number;
    outcome: 'CORRECT' | 'WRONG' | 'SKIPPED';
    questionSentAt: Date;
  }>,
) => {
  const run = await prisma.quizRun.create({
    data: {
      userId,
      status: 'COMPLETED',
      totalQuestions: items.length,
      currentIndex: items.length,
      correctCount: items.filter((item) => item.outcome === 'CORRECT').length,
      wrongCount: items.filter((item) => item.outcome === 'WRONG').length,
      skippedCount: items.filter((item) => item.outcome === 'SKIPPED').length,
      finishedAt: new Date(),
      durationSeconds: Math.max(1, items.length * 5),
    },
  });

  await prisma.quizRunItem.createMany({
    data: items.map((item, questionIndex) => ({
      runId: run.id,
      questionIndex,
      wordId: item.wordId,
      direction: 'EN_TO_RU',
      mode: 'MULTIPLE_CHOICE',
      promptText: `word-${item.wordId}`,
      options: ['opt-1', 'opt-2', 'opt-3', 'opt-4'] as any,
      correctAnswer: 'opt-1',
      correctOptionIndex: 0,
      selectedOptionIndex: item.outcome === 'SKIPPED' ? null : item.outcome === 'CORRECT' ? 0 : 1,
      selectedAnswer: item.outcome === 'SKIPPED' ? null : item.outcome === 'CORRECT' ? 'opt-1' : 'opt-2',
      outcome: item.outcome,
      questionSentAt: item.questionSentAt,
      answeredAt: item.questionSentAt,
    })),
  });
};

beforeAll(async () => {
  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;
  process.env.NEWS_RSS_MATCH_MIN_SCORE = '55';
  process.env.NEWS_RSS_TOKEN_COVERAGE_MIN = '0.8';

  vi.resetModules();
  const service = await import('../src/services/newsFallbackService');

  queueWordNewsResolve = service.queueWordNewsResolve;
  enqueueWordsNeedingNewsResolve = service.enqueueWordsNeedingNewsResolve;
  resolvePendingNewsExamples = service.resolvePendingNewsExamples;
  markOldNewsForRefresh = service.markOldNewsForRefresh;
  markBrokenNewsSourcesForRefresh = service.markBrokenNewsSourcesForRefresh;
  rearmExhaustedNewsResolveJobs = service.rearmExhaustedNewsResolveJobs;
  buildUserNewsDigest = service.buildUserNewsDigest;
  refreshNewsCacheFromRss = service.refreshNewsCacheFromRss;
  calculateRetryDate = service.calculateRetryDate;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
  await prisma.newsResolveJob.deleteMany({});
  await prisma.newsProviderState.deleteMany({});
  await prisma.newsCache.deleteMany({});
  await prisma.user.create({ data: { id: userId, language: 'ru' } });

  process.env.NEWS_RSS_FEEDS = DEFAULT_TEST_RSS_FEEDS;
  process.env.NEWDATA_API_URL = TEST_NEWDATA_API;
  process.env.NEWDATA_API_KEY = '';
  process.env.NEWS_NEWDATA_DAILY_LIMIT = '200';
  process.env.NEWS_NEWDATA_DAILY_BUDGET = '120';
  process.env.NEWS_NEWDATA_WORD_RETRY_HOURS = '12';
  process.env.GDELT_API_URL = TEST_GDELT_API;
  process.env.NEWS_GDELT_MIN_INTERVAL_SECONDS = '10';
  process.env.NEWS_GDELT_COOLDOWN_MINUTES = '30';
  process.env.NEWS_GDELT_WORD_RETRY_HOURS = '24';
  process.env.GUARDIAN_API_KEY = 'test';
  process.env.NEWS_GUARDIAN_SKIP_WITHOUT_KEY = 'true';
  delete process.env.NEWS_NOT_FOUND_RETRY_STEPS_MINUTES;
  process.env.NEWS_NOT_FOUND_RETRY_HOURS = '12';
  process.env.NEWS_MAX_JOB_ATTEMPTS = '5';
  process.env.NEWS_RETRY_BASE_MINUTES = '15';
  process.env.NEWS_RETRY_MAX_MINUTES = '120';
  process.env.NEWS_JOB_RETENTION_DAYS = '14';
  process.env.NEWS_EXHAUSTED_RETRY_HOURS = '24';
  process.env.NEWS_SOURCE_LINK_TIMEOUT_MS = '5000';
  process.env.NEWS_SOURCE_LINK_CHECK_BATCH = '30';

  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await prisma.newsResolveJob.deleteMany({});
  await prisma.newsProviderState.deleteMany({});
  await prisma.newsCache.deleteMany({});
  await prisma.$disconnect();
});

describe('newsFallbackService integration', () => {
  it('Tier1 hit uses RSS cache only and skips external APIs', async () => {
    const word = await createStage4Word('economy', 'ekonomika');
    await seedNews({
      title: 'Economic reforms continue in Tashkent',
      snippet: 'Reforms are discussed by officials extensively to drastically improve the local economic climate.',
      contentHash: 'tier1-economy-economic',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await queueWordNewsResolve(word.id);
    const resolved = await resolvePendingNewsExamples(10);

    expect(resolved.resolved).toBe(1);
    expect(resolved.claimed).toBe(1);
    const refreshed = await prisma.word.findUnique({ where: { id: word.id } });
    expect(refreshed?.newsExampleTier).toBe('CACHE');
    expect(refreshed?.newsExampleText?.toLowerCase()).toContain('economic');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Tier1 picks body fragment around matched word, not body start', async () => {
    const word = await createStage4Word('suffice', 'dostatochno');
    await seedNews({
      title: 'Editorial update on policy reforms',
      snippet: 'A broad editorial overview discussing cabinet changes and election strategy.',
      bodyText: `${'This paragraph discusses reforms without the target token. '.repeat(12)}Analysts say youthful optimism may not suffice before the June elections.`,
      contentHash: 'tier1-body-fragment-suffice',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await queueWordNewsResolve(word.id);
    const resolved = await resolvePendingNewsExamples(10);

    expect(resolved.resolved).toBe(1);
    const refreshed = await prisma.word.findUnique({ where: { id: word.id } });
    expect(refreshed?.newsExampleTier).toBe('CACHE');
    expect(refreshed?.newsExampleText?.toLowerCase()).toContain('suffice');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Tier1 falls back to title snippet when matched word is only in title', async () => {
    const word = await createStage4Word('suffice', 'dostatochno');
    await seedNews({
      title: 'Will this suffice?',
      snippet: 'Editorial analysis about coalition talks and regional policy shifts this week.',
      bodyText: 'Cabinet negotiations continue while lawmakers discuss new policy measures and election strategy.',
      contentHash: 'tier1-title-only-suffice',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await queueWordNewsResolve(word.id);
    const resolved = await resolvePendingNewsExamples(10);

    expect(resolved.resolved).toBe(1);
    const refreshed = await prisma.word.findUnique({ where: { id: word.id } });
    expect(refreshed?.newsExampleTier).toBe('CACHE');
    expect((refreshed?.newsExampleText ?? '').toLowerCase()).toContain('suffice');
    expect(refreshed?.newsExampleText).toBe('Will this suffice?');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Tier1 soft matching resolves when strict forms miss but ending-form variant exists', async () => {
    const word = await createStage4Word('economy', 'ekonomika');
    await seedNews({
      title: 'Economic outlook update',
      snippet: 'Economic indicators improved this quarter after several policy changes across the region.',
      bodyText: 'Economic growth accelerated after reforms and stronger market confidence.',
      contentHash: 'tier1-soft-ending-economic',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await queueWordNewsResolve(word.id);
    const resolved = await resolvePendingNewsExamples(10);

    expect(resolved.resolved).toBe(1);
    const refreshed = await prisma.word.findUnique({ where: { id: word.id } });
    expect(refreshed?.newsExampleTier).toBe('CACHE');
    expect((refreshed?.newsExampleText ?? '').toLowerCase()).toContain('economic');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Tier2 hit uses NewsData Uzbekistan scope', async () => {
    process.env.NEWDATA_API_KEY = 'test-key';
    const word = await createStage4Word('market', 'rynok');

    const fetchSpy = mockFetchByUrl(async (url) => {
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://newsdata.test/api/1/latest');
      expect(parsed.searchParams.get('country')).toBe('uz');
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: 'success',
            results: [
              {
                title: 'Market confidence grows in Uzbekistan',
                link: 'https://newsdata.example/market-uz',
                description: 'Market indicators improved this week after a long period of uncertainty.',
                language: 'en',
              },
            ],
          }),
      } as any;
    });

    await queueWordNewsResolve(word.id);
    const resolved = await resolvePendingNewsExamples(10);

    expect(resolved.resolved).toBe(1);
    const refreshed = await prisma.word.findUnique({ where: { id: word.id } });
    expect(refreshed?.newsExampleTier).toBe('NEWSDATA');
    expect(refreshed?.newsExampleSourceUrl).toBe('https://newsdata.example/market-uz');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('Tier2 global pass works when NewsData UZ scope is empty', async () => {
    process.env.NEWDATA_API_KEY = 'test-key';
    const word = await createStage4Word('technology', 'tekhnologiya');

    const fetchSpy = mockFetchByUrl(async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('country') === 'uz') {
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'success', results: [] }) } as any;
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: 'success',
            results: [
              {
                title: 'Technology trends are changing the market',
                link: 'https://newsdata.example/technology-global',
                description: 'Technology investments accelerated globally, reaching new all-time highs across all sectors.',
                language: 'en',
              },
            ],
          }),
      } as any;
    });

    await queueWordNewsResolve(word.id);
    const resolved = await resolvePendingNewsExamples(10);

    expect(resolved.resolved).toBe(1);
    const refreshed = await prisma.word.findUnique({ where: { id: word.id } });
    expect(refreshed?.newsExampleTier).toBe('NEWSDATA');
    expect(refreshed?.newsExampleSourceUrl).toBe('https://newsdata.example/technology-global');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('NewsData quota exhausted falls back to GDELT', async () => {
    process.env.NEWDATA_API_KEY = 'test-key';
    process.env.NEWS_NEWDATA_DAILY_BUDGET = '1';
    const word = await createStage4Word('policy', 'politika');

    await prisma.newsProviderState.create({
      data: {
        provider: 'NEWSDATA',
        dayStartUtc: utcDayStart(),
        requestsToday: 1,
      },
    });

    const fetchSpy = mockFetchByUrl(async (url) => {
      expect(url.startsWith(TEST_GDELT_API)).toBe(true);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            articles: [
              {
                title: 'Policy update from world news',
                url: 'https://gdelt.example/policy',
                snippet: 'The policy update affects the region significantly, leading directly to sweeping economic changes.',
                language: 'English',
              },
            ],
          }),
      } as any;
    });

    await queueWordNewsResolve(word.id);
    const resolved = await resolvePendingNewsExamples(10);

    expect(resolved.resolved).toBe(1);
    const refreshed = await prisma.word.findUnique({ where: { id: word.id } });
    expect(refreshed?.newsExampleTier).toBe('GDELT');
    expect(refreshed?.newsExampleSourceUrl).toBe('https://gdelt.example/policy');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('GDELT global fallback runs in the same cycle without self-rate-limit', async () => {
    const firstWord = await createStage4Word('energy', 'energiya');
    const secondWord = await createStage4Word('inflation', 'inflyatsiya');

    const fetchSpy = mockFetchByUrl(async (url) => {
      expect(url.startsWith(TEST_GDELT_API)).toBe(true);
      return { ok: true, status: 200, text: async () => JSON.stringify({ articles: [] }) } as any;
    });

    await queueWordNewsResolve(firstWord.id);
    await resolvePendingNewsExamples(10);

    await queueWordNewsResolve(secondWord.id);
    await resolvePendingNewsExamples(10);

    // First word: two GDELT scopes in one cycle. Second word: rate-limited on first scope.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondJob = await prisma.newsResolveJob.findUnique({ where: { wordId: secondWord.id } });
    expect(secondJob?.lastError).toBe('gdelt_rate_limited');
    expect(secondJob?.attempts).toBe(0);
  });

  it('enqueueWordsNeedingNewsResolve keeps deferred failed schedule/attempts', async () => {
    const word = await createStage4Word('logistics', 'logistika');
    await queueWordNewsResolve(word.id);
    const deferredAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await prisma.newsResolveJob.update({
      where: { wordId: word.id },
      data: {
        status: 'FAILED',
        attempts: 3,
        lastError: 'news_not_found',
        scheduledAt: deferredAt,
      },
    });

    const enqueued = await enqueueWordsNeedingNewsResolve(10);
    expect(enqueued).toBe(1);

    const job = await prisma.newsResolveJob.findUnique({ where: { wordId: word.id } });
    expect(job?.status).toBe('FAILED');
    expect(job?.attempts).toBe(3);
    expect(job?.lastError).toBe('news_not_found');
    expect(job?.scheduledAt.getTime()).toBe(deferredAt.getTime());
  });

  it('GDELT 429 sets cooldown and defers job', async () => {
    const word = await createStage4Word('finance', 'finansy');

    const fetchSpy = mockFetchByUrl(async (url) => {
      expect(url.startsWith(TEST_GDELT_API)).toBe(true);
      return { ok: false, status: 429, text: async () => 'rate limited' } as any;
    });

    await queueWordNewsResolve(word.id);
    const resolved = await resolvePendingNewsExamples(10);

    expect(resolved.resolved).toBe(0);
    expect(resolved.deferred).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const job = await prisma.newsResolveJob.findUnique({ where: { wordId: word.id } });
    expect(job?.lastError).toBe('gdelt_cooldown');
    expect(job?.attempts).toBe(0);
    expect(job?.scheduledAt.getTime() ?? 0).toBeGreaterThan(Date.now() + 20 * 60 * 1000);

    const gdeltState = await prisma.newsProviderState.findUnique({ where: { provider: 'GDELT' } });
    expect(gdeltState?.cooldownUntil).toBeTruthy();
  });

  it('Guardian is skipped when API key is not valid', async () => {
    const word = await createStage4Word('agriculture', 'selskoe khozyaistvo');
    await prisma.newsProviderState.create({
      data: {
        provider: 'GDELT',
        dayStartUtc: utcDayStart(),
        requestsToday: 0,
        cooldownUntil: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await queueWordNewsResolve(word.id);
    await resolvePendingNewsExamples(10);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refreshNewsCacheFromRss stays resilient on broken feed', async () => {
    process.env.NEWS_RSS_FEEDS = 'https://feed.invalid/rss,https://feed.ok/rss';

    const validRss = `
      <rss>
        <channel>
          <title>Feed OK</title>
          <item>
            <title>Apple supply chain update</title>
            <link>https://kun.uz/en/news/apple-supply</link>
            <description>Apple exports increased this week.</description>
            <pubDate>Thu, 05 Mar 2026 10:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    mockFetchByUrl(async (url) => {
      if (url.includes('feed.invalid')) {
        return { ok: true, status: 200, text: async () => '<rss><channel><item>' } as any;
      }
      return { ok: true, status: 200, text: async () => validRss } as any;
    });

    const result = await refreshNewsCacheFromRss();
    expect(result.totalProcessed).toBeGreaterThanOrEqual(1);
  });

  it('resolvePendingNewsExamples applies limit by claimed jobs, not resolved jobs', async () => {
    process.env.NEWDATA_API_KEY = '';
    mockEmptyExternalNewsProviders();

    const words = await Promise.all([
      createStage4Word('economy', 'ekonomika'),
      createStage4Word('market', 'rynok'),
      createStage4Word('policy', 'politika'),
    ]);

    for (const word of words) {
      await queueWordNewsResolve(word.id);
    }

    const result = await resolvePendingNewsExamples(2);

    expect(result.claimed).toBe(2);
    const processedTotal = result.resolved + result.failed + result.deferred;
    expect(processedTotal).toBe(2);

    const pendingCount = await prisma.newsResolveJob.count({ where: { status: 'PENDING' } });
    expect(pendingCount).toBe(1);
  });

  it('resolvePendingNewsExamples respects NEWS_MAX_JOB_ATTEMPTS', async () => {
    process.env.NEWS_MAX_JOB_ATTEMPTS = '1';
    const word = await createStage4Word('banking', 'bankovskoe delo');
    await queueWordNewsResolve(word.id);

    await prisma.newsResolveJob.update({
      where: { wordId: word.id },
      data: {
        status: 'FAILED',
        attempts: 1,
        lastError: 'news_not_found',
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });

    const second = await resolvePendingNewsExamples(1);
    expect(second.claimed).toBe(0);

    const job = await prisma.newsResolveJob.findUnique({ where: { wordId: word.id } });
    expect(job?.status).toBe('FAILED');
    expect(job?.attempts).toBe(1);
  });

  it('news_not_found uses staged retry minutes by attempt', async () => {
    process.env.NEWS_NOT_FOUND_RETRY_STEPS_MINUTES = '30,120,360';
    process.env.NEWS_NOT_FOUND_RETRY_HOURS = '';

    const first = calculateRetryDate(1, 'news_not_found');
    const second = calculateRetryDate(2, 'news_not_found');
    const third = calculateRetryDate(3, 'news_not_found');
    const fourth = calculateRetryDate(10, 'news_not_found');

    const now = Date.now();
    const firstDelayMinutes = Math.round((first.getTime() - now) / 60000);
    const secondDelayMinutes = Math.round((second.getTime() - now) / 60000);
    const thirdDelayMinutes = Math.round((third.getTime() - now) / 60000);
    const fourthDelayMinutes = Math.round((fourth.getTime() - now) / 60000);

    expect(firstDelayMinutes).toBeGreaterThanOrEqual(25);
    expect(firstDelayMinutes).toBeLessThanOrEqual(35);
    expect(secondDelayMinutes).toBeGreaterThanOrEqual(110);
    expect(secondDelayMinutes).toBeLessThanOrEqual(130);
    expect(thirdDelayMinutes).toBeGreaterThanOrEqual(350);
    expect(thirdDelayMinutes).toBeLessThanOrEqual(370);
    // Capped by last configured step.
    expect(fourthDelayMinutes).toBeGreaterThanOrEqual(350);
    expect(fourthDelayMinutes).toBeLessThanOrEqual(370);
  });

  it('rearmExhaustedNewsResolveJobs moves exhausted failed jobs back to pending', async () => {
    process.env.NEWS_MAX_JOB_ATTEMPTS = '2';
    process.env.NEWS_EXHAUSTED_RETRY_HOURS = '1';

    const word = await createStage4Word('commodity', 'syre');
    await queueWordNewsResolve(word.id);

    await prisma.newsResolveJob.update({
      where: { wordId: word.id },
      data: {
        status: 'FAILED',
        attempts: 2,
        lastError: 'news_not_found',
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });

    await prisma.$executeRaw`
      UPDATE "NewsResolveJob"
      SET "updatedAt" = ${new Date(Date.now() - 2 * 60 * 60 * 1000)}
      WHERE "wordId" = ${word.id}
    `;

    const rearmed = await rearmExhaustedNewsResolveJobs(10);
    expect(rearmed).toBe(1);

    const job = await prisma.newsResolveJob.findUnique({ where: { wordId: word.id } });
    expect(job?.status).toBe('PENDING');
    expect(job?.attempts).toBe(0);
    expect(job?.lastError).toBe('rearmed_after_exhausted');
  });

  it('parallel resolve cycles do not claim the same job', async () => {
    process.env.NEWDATA_API_KEY = 'test-key';

    const words = await Promise.all([
      createStage4Word('reform', 'reforma'),
      createStage4Word('growth', 'rost'),
    ]);

    const fetchSpy = mockFetchByUrl(async (url) => {
      const parsed = new URL(url);
      if (!url.startsWith(TEST_NEWDATA_API)) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'success', results: [] }) } as any;
      }
      const q = parsed.searchParams.get('q') ?? 'word';
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: 'success',
            results: [
              {
                title: `${q} update in Uzbekistan`,
                link: `https://newsdata.example/${q}`,
                description: `${q} is discussed globally with detailed analysis and practical implications for policy.`,
                language: 'en',
              },
            ],
          }),
      } as any;
    });

    for (const word of words) {
      await queueWordNewsResolve(word.id);
    }

    const [first, second] = await Promise.all([
      resolvePendingNewsExamples(1),
      resolvePendingNewsExamples(1),
    ]);

    expect(first.claimed + second.claimed).toBe(2);
    expect(first.resolved + second.resolved).toBe(2);

    const doneCount = await prisma.newsResolveJob.count({ where: { status: 'DONE' } });
    expect(doneCount).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('reclaims stale PROCESSING job and resolves it', async () => {
    const word = await createStage4Word('economy', 'ekonomika');
    await seedNews({
      title: 'Economic reform update',
      snippet: 'The economy improved after broad reform efforts across sectors.',
      contentHash: 'stale-processing-economy',
    });

    await queueWordNewsResolve(word.id);
    await prisma.newsResolveJob.update({
      where: { wordId: word.id },
      data: {
        status: 'PROCESSING',
        attempts: 1,
        lockedAt: new Date(Date.now() - 20 * 60 * 1000),
        scheduledAt: new Date(Date.now() - 60 * 1000),
      },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await resolvePendingNewsExamples(1);

    expect(result.claimed).toBe(1);
    expect(result.resolved).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    const job = await prisma.newsResolveJob.findUnique({ where: { wordId: word.id } });
    expect(job?.status).toBe('DONE');
  });

  it('does not reclaim fresh PROCESSING job lock', async () => {
    process.env.NEWS_RETRY_BASE_MINUTES = '30';
    const word = await createStage4Word('market', 'rynok');
    await queueWordNewsResolve(word.id);
    await prisma.newsResolveJob.update({
      where: { wordId: word.id },
      data: {
        status: 'PROCESSING',
        attempts: 1,
        lockedAt: new Date(Date.now() - 5 * 60 * 1000),
        scheduledAt: new Date(Date.now() - 60 * 1000),
      },
    });
    const before = await prisma.newsResolveJob.findUnique({ where: { wordId: word.id } });
    expect(before?.status).toBe('PROCESSING');

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await resolvePendingNewsExamples(1);

    expect(result.claimed).toBe(0);
    expect(result.resolved).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    const job = await prisma.newsResolveJob.findUnique({ where: { wordId: word.id } });
    expect(job?.status).toBe('PROCESSING');
  });

  it('markOldNewsForRefresh marks only stale prepared examples', async () => {
    const staleWord = await createStage4Word('staleword', 'stale-ru');
    const freshWord = await createStage4Word('freshword', 'fresh-ru');
    const alreadyMarked = await createStage4Word('already', 'already-ru');

    await prisma.word.update({
      where: { id: staleWord.id },
      data: {
        newsExampleText: 'Old example for stale word with enough details in text.',
        newsExamplePreparedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        newsExampleNeedsRefresh: false,
      },
    });

    await prisma.word.update({
      where: { id: freshWord.id },
      data: {
        newsExampleText: 'Fresh example that should not be marked for refresh.',
        newsExamplePreparedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        newsExampleNeedsRefresh: false,
      },
    });

    await prisma.word.update({
      where: { id: alreadyMarked.id },
      data: {
        newsExampleText: 'Old example already marked previously.',
        newsExamplePreparedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        newsExampleNeedsRefresh: true,
      },
    });

    const marked = await markOldNewsForRefresh();
    expect(marked).toBe(1);

    const [staleRow, freshRow, alreadyRow] = await Promise.all([
      prisma.word.findUnique({ where: { id: staleWord.id } }),
      prisma.word.findUnique({ where: { id: freshWord.id } }),
      prisma.word.findUnique({ where: { id: alreadyMarked.id } }),
    ]);

    expect(staleRow?.newsExampleNeedsRefresh).toBe(true);
    expect(freshRow?.newsExampleNeedsRefresh).toBe(false);
    expect(alreadyRow?.newsExampleNeedsRefresh).toBe(true);
  });

  it('markBrokenNewsSourcesForRefresh clears broken URL and requeues word', async () => {
    const word = await createStage4Word('economy', 'ekonomika');
    await prisma.word.update({
      where: { id: word.id },
      data: {
        newsExampleText: 'The economy is recovering steadily.',
        newsExampleSourceUrl: 'https://dead.example/economy',
        newsExampleSourceTitle: 'Dead source',
        newsExamplePreparedAt: new Date(),
        newsExampleNeedsRefresh: false,
      },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const marked = await markBrokenNewsSourcesForRefresh(10);
    expect(marked).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const updatedWord = await prisma.word.findUnique({ where: { id: word.id } });
    expect(updatedWord?.newsExampleSourceUrl).toBeNull();
    expect(updatedWord?.newsExampleSourceTitle).toBe('Dead source');
    expect(updatedWord?.newsExampleNeedsRefresh).toBe(true);

    const job = await prisma.newsResolveJob.findUnique({ where: { wordId: word.id } });
    expect(job?.status).toBe('PENDING');
    expect(job?.attempts).toBe(0);
  });

  it('refreshNewsCacheFromRss updates existing row by URL without creating duplicate', async () => {
    process.env.NEWS_RSS_FEEDS = 'https://feed.dedupe/rss';

    const initialRss = `
      <rss>
        <channel>
          <title>Feed One</title>
          <item>
            <title>Economic outlook is improving in region</title>
            <link>https://example.com/news/economy</link>
            <description>The economy outlook remains optimistic after reforms and investment growth.</description>
            <pubDate>Thu, 05 Mar 2026 09:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    const updatedRss = `
      <rss>
        <channel>
          <title>Feed One</title>
          <item>
            <title>Economic outlook improved after policy changes</title>
            <link>https://example.com/news/economy</link>
            <description>Policy changes improved investor confidence and accelerated economic growth this quarter.</description>
            <pubDate>Thu, 05 Mar 2026 11:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => initialRss } as any)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => updatedRss } as any);

    const first = await refreshNewsCacheFromRss();
    const second = await refreshNewsCacheFromRss();

    expect(first.inserted).toBe(1);
    expect(second.updated).toBe(1);

    const rows = await prisma.newsCache.findMany({
      where: { url: 'https://example.com/news/economy' },
      orderBy: { id: 'asc' },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.title).toContain('improved');
  });

  it('buildUserNewsDigest returns NEWSDATA cards from DB and updates last-opened time', async () => {
    const word = await createStage4Word('economy', 'ekonomika');

    await prisma.word.update({
      where: { id: word.id },
      data: {
        newsExampleText: 'The economy is recovering steadily.',
        newsExampleTier: 'NEWSDATA',
        newsExampleSourceUrl: 'https://newsdata.example/economy',
        newsExamplePreparedAt: new Date(),
      },
    });

    const digest = await buildUserNewsDigest(userId, 3);

    expect(digest.length).toBe(1);
    expect(digest[0]?.highlightedText).toContain('<b>ECONOMY</b>');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.newsDigestLastOpenedAt).toBeTruthy();
  });

  it('buildUserNewsDigest emits debug payload when env flag is enabled', async () => {
    const word = await createStage4Word('economy', 'ekonomika');

    await prisma.word.update({
      where: { id: word.id },
      data: {
        newsExampleText: 'The economy is recovering steadily.',
        newsExampleTier: 'CACHE',
        newsExampleSourceUrl: 'https://news.example/economy',
        newsExampleSourceTitle: 'Economy report',
        newsExamplePreparedAt: new Date(),
      },
    });

    process.env.NEWS_SELECTION_DEBUG = '1';
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const digest = await buildUserNewsDigest(userId, 3);
      expect(digest).toHaveLength(1);

      const debugCall = consoleSpy.mock.calls.find(([message]) => message === '[news][selection]');
      expect(debugCall).toBeTruthy();
      expect((debugCall?.[1] as any)?.label).toBe('digest-ranking');
      expect(Array.isArray((debugCall?.[1] as any)?.digestWords)).toBe(true);
      expect(Array.isArray((debugCall?.[1] as any)?.topCandidates)).toBe(true);
    } finally {
      delete process.env.NEWS_SELECTION_DEBUG;
      consoleSpy.mockRestore();
    }
  });

  it('buildUserNewsDigest boosts difficult words above equally fresh easy words', async () => {
    const difficultWord = await createStage4Word('economy', 'ekonomika');
    const easyWord = await createStage4Word('market', 'rynok');
    const preparedAt = new Date(Date.now() - 60 * 60 * 1000);

    await prisma.word.update({
      where: { id: difficultWord.id },
      data: {
        newsExampleText: 'The economy remains under pressure after a difficult quarter.',
        newsExampleTier: 'CACHE',
        newsExampleSourceUrl: 'https://news.example/economy',
        newsExampleSourceTitle: 'Economy report',
        newsExamplePreparedAt: preparedAt,
      },
    });
    await prisma.word.update({
      where: { id: easyWord.id },
      data: {
        newsExampleText: 'The market stabilized after last week.',
        newsExampleTier: 'CACHE',
        newsExampleSourceUrl: 'https://news.example/market',
        newsExampleSourceTitle: 'Market report',
        newsExamplePreparedAt: preparedAt,
      },
    });

    await seedQuizUsage([
      { wordId: difficultWord.id, outcome: 'WRONG', questionSentAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
      { wordId: difficultWord.id, outcome: 'WRONG', questionSentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
      { wordId: difficultWord.id, outcome: 'WRONG', questionSentAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000) },
    ]);

    const digest = await buildUserNewsDigest(userId, 1);

    expect(digest).toHaveLength(1);
    expect(digest[0]?.wordEn).toBe('economy');
  });

  it('buildUserNewsDigest falls back to source title using the base word form', async () => {
    const word = await createStage4Word('economy', 'ekonomika');

    await prisma.word.update({
      where: { id: word.id },
      data: {
        newsExampleText: 'Markets rallied today after the vote.',
        newsExampleMatchedWord: 'economic',
        newsExampleTier: 'CACHE',
        newsExampleSourceTitle: 'Economy outlook improves',
        newsExamplePreparedAt: new Date(),
      },
    });

    const digest = await buildUserNewsDigest(userId, 1);

    expect(digest).toHaveLength(1);
    expect(digest[0]?.wordEn).toBe('economy');
    expect(digest[0]?.highlightedText).toContain('<u><b>ECONOMY</b></u>');
  });

  it('buildUserNewsDigest skips a very recent quiz word when the batch is full', async () => {
    const words = await Promise.all(
      Array.from({ length: 6 }, (_, index) => createStage4Word(`word-${index + 1}`, `slovo-${index + 1}`)),
    );

    const now = Date.now();
    for (const [index, word] of words.entries()) {
      await prisma.word.update({
        where: { id: word.id },
        data: {
          newsExampleText: `The word-${index + 1} appears in this article.`,
          newsExampleTier: 'CACHE',
          newsExampleSourceUrl: `https://news.example/word-${index + 1}`,
          newsExampleSourceTitle: `Word ${index + 1} article`,
          newsExamplePreparedAt: new Date(now - index * 60 * 60 * 1000),
        },
      });
    }

    const previousRun = await prisma.quizRun.create({
      data: {
        userId,
        status: 'COMPLETED',
        totalQuestions: 1,
        currentIndex: 1,
        correctCount: 1,
        finishedAt: new Date(),
        durationSeconds: 9,
      },
    });

    const recentQuestionTime = new Date(now - 2 * 60 * 60 * 1000);
    await prisma.quizRunItem.create({
      data: {
        runId: previousRun.id,
        questionIndex: 0,
        wordId: words[0]!.id,
        direction: 'EN_TO_RU',
        mode: 'MULTIPLE_CHOICE',
        promptText: 'word-1',
        options: ['slovo-1', 'slovo-2', 'slovo-3', 'slovo-4'] as any,
        correctAnswer: 'slovo-1',
        correctOptionIndex: 0,
        selectedOptionIndex: 0,
        selectedAnswer: 'slovo-1',
        outcome: 'CORRECT',
        questionSentAt: recentQuestionTime,
        answeredAt: recentQuestionTime,
      },
    });

    const digest = await buildUserNewsDigest(userId, 5);

    expect(digest).toHaveLength(5);
    expect(digest.map((item) => item.wordEn)).not.toContain('word-1');
  });
});
