import { afterEach, describe, expect, it, vi } from 'vitest';

const scheduleMock = vi.fn();
const enqueueMock = vi.fn().mockResolvedValue(0);
const resolveMock = vi.fn().mockResolvedValue({
  claimed: 0,
  resolved: 0,
  failed: 0,
  deferred: 0,
  durationMs: 1,
});
const refreshMock = vi.fn().mockResolvedValue({ inserted: 0, updated: 0, totalProcessed: 0 });
const markOldMock = vi.fn().mockResolvedValue(0);
const sourceLinkCheckMock = vi.fn().mockResolvedValue(0);
const rearmMock = vi.fn().mockResolvedValue(0);
const pruneMock = vi.fn().mockResolvedValue(undefined);
const queueCountMock = vi.fn().mockResolvedValue(0);
const cacheCountMock = vi.fn().mockResolvedValue(0);

vi.mock('node-cron', () => ({
  default: {
    schedule: scheduleMock,
  },
}));

vi.mock('../src/services/newsFallbackService', () => ({
  enqueueWordsNeedingNewsResolve: enqueueMock,
  pruneExpiredNewsCacheAndOldJobs: pruneMock,
  refreshNewsCacheFromRss: refreshMock,
  resolvePendingNewsExamples: resolveMock,
  markOldNewsForRefresh: markOldMock,
  markBrokenNewsSourcesForRefresh: sourceLinkCheckMock,
  rearmExhaustedNewsResolveJobs: rearmMock,
  readMarkOldCron: () => '15 2 * * *',
  readMetricsCron: () => '0 * * * *',
  readSourceLinkCheckCron: () => '45 * * * *',
}));

vi.mock('../src/db/client', () => ({
  prisma: {
    newsResolveJob: {
      count: queueCountMock,
    },
    newsCache: {
      count: cacheCountMock,
    },
  },
}));

afterEach(() => {
  scheduleMock.mockClear();
  enqueueMock.mockClear();
  resolveMock.mockClear();
  refreshMock.mockClear();
  markOldMock.mockClear();
  sourceLinkCheckMock.mockClear();
  rearmMock.mockClear();
  pruneMock.mockClear();
  queueCountMock.mockClear();
  cacheCountMock.mockClear();
  delete process.env.NEWS_RSS_REFRESH_CRON;
  delete process.env.NEWS_ENQUEUE_CRON;
  delete process.env.NEWS_RESOLVE_CRON;
  delete process.env.NEWS_PRUNE_CRON;
});

describe('news worker bootstrap', () => {
  it('registers cron jobs including daily stale-mark and hourly metrics', async () => {
    process.env.NEWS_RSS_REFRESH_CRON = '1 * * * *';
    process.env.NEWS_ENQUEUE_CRON = '2 * * * *';
    process.env.NEWS_RESOLVE_CRON = '*/7 * * * *';
    process.env.NEWS_PRUNE_CRON = '55 3 * * *';

    const { startNewsWorker } = await import('../src/scheduler/newsWorker');
    startNewsWorker();

    const crons = scheduleMock.mock.calls.map(([expr]) => expr);
    expect(crons).toContain('1 * * * *');
    expect(crons).toContain('2 * * * *');
    expect(crons).toContain('*/7 * * * *');
    expect(crons).toContain('55 3 * * *');
    expect(crons).toContain('15 2 * * *');
    expect(crons).toContain('0 * * * *');
    expect(crons).toContain('45 * * * *');
  });

  it('runs enqueue and resolve immediately on startup', async () => {
    const { startNewsWorker } = await import('../src/scheduler/newsWorker');
    startNewsWorker();

    await Promise.resolve();
    await Promise.resolve();

    expect(rearmMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(resolveMock).toHaveBeenCalledTimes(1);
  });
});
