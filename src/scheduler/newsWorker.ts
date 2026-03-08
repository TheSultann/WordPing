import 'dotenv/config';
import cron from 'node-cron';
import { prisma } from '../db/client';
import {
  enqueueWordsNeedingNewsResolve,
  markBrokenNewsSourcesForRefresh,
  markOldNewsForRefresh,
  pruneExpiredNewsCacheAndOldJobs,
  rearmExhaustedNewsResolveJobs,
  readMarkOldCron,
  readMetricsCron,
  readSourceLinkCheckCron,
  refreshNewsCacheFromRss,
  resolvePendingNewsExamples,
} from '../services/newsFallbackService';

const RSS_REFRESH_CRON = process.env.NEWS_RSS_REFRESH_CRON ?? '0 * * * *';
const ENQUEUE_CRON = process.env.NEWS_ENQUEUE_CRON ?? '0 * * * *';
const RESOLVE_CRON = process.env.NEWS_RESOLVE_CRON ?? '*/5 * * * *';
const MARK_OLD_CRON = readMarkOldCron();
const METRICS_CRON = readMetricsCron();
const SOURCE_LINK_CHECK_CRON = readSourceLinkCheckCron();
const PRUNE_CRON = process.env.NEWS_PRUNE_CRON ?? '20 3 * * *';

const metrics = {
  staleMarkedHour: 0,
  resolvedHour: 0,
  rssUpsertsHour: 0,
  rearmedHour: 0,
  brokenLinksHour: 0,
};

const resetMetrics = () => {
  metrics.staleMarkedHour = 0;
  metrics.resolvedHour = 0;
  metrics.rssUpsertsHour = 0;
  metrics.rearmedHour = 0;
  metrics.brokenLinksHour = 0;
};

const runEnqueue = async () => {
  try {
    const start = performance.now();
    const rearmed = await rearmExhaustedNewsResolveJobs();
    metrics.rearmedHour += rearmed;

    const enqueued = await enqueueWordsNeedingNewsResolve();
    const durationMs = performance.now() - start;
    if (rearmed > 0) {
      console.log(`[news-worker] rearmed exhausted jobs: ${rearmed}`);
    }
    if (enqueued > 0) {
      console.log(`[news-worker] enqueued words: ${enqueued} (took ${Math.round(durationMs)}ms)`);
    }
  } catch (error) {
    console.error('[news-worker] enqueue failed', error);
  }
};

const runRssRefresh = async () => {
  try {
    const start = performance.now();
    const processed = await refreshNewsCacheFromRss();
    const durationMs = performance.now() - start;
    if (processed.totalProcessed > 0) {
      metrics.rssUpsertsHour += processed.totalProcessed;
      console.log(
        `[news-worker] rss cache updated: inserted=${processed.inserted}, updated=${processed.updated}, total=${processed.totalProcessed} (took ${Math.round(durationMs)}ms)`
      );
    }
  } catch (error) {
    console.error('[news-worker] rss refresh failed', error);
  }
};

const runResolve = async () => {
  try {
    const start = performance.now();
    const result = await resolvePendingNewsExamples();
    const durationMs = performance.now() - start;
    if (result.claimed > 0) {
      metrics.resolvedHour += result.resolved;
      console.log(
        `[news-worker] resolve cycle: claimed=${result.claimed}, resolved=${result.resolved}, failed=${result.failed}, deferred=${result.deferred} (took ${Math.round(durationMs)}ms)`
      );
    }
  } catch (error) {
    console.error('[news-worker] resolve cycle failed', error);
  }
};

const runMarkOldForRefresh = async () => {
  try {
    const start = performance.now();
    const marked = await markOldNewsForRefresh();
    const durationMs = performance.now() - start;
    metrics.staleMarkedHour += marked;
    if (marked > 0) {
      console.log(`[news-worker] marked stale news for refresh: ${marked} (took ${Math.round(durationMs)}ms)`);
    }
  } catch (error) {
    console.error('[news-worker] mark-old-for-refresh failed', error);
  }
};

const runSourceLinkHealthCheck = async () => {
  try {
    const start = performance.now();
    const marked = await markBrokenNewsSourcesForRefresh();
    const durationMs = performance.now() - start;
    metrics.brokenLinksHour += marked;
    if (marked > 0) {
      console.log(`[news-worker] broken source links marked for refresh: ${marked} (took ${Math.round(durationMs)}ms)`);
    }
  } catch (error) {
    console.error('[news-worker] source link health-check failed', error);
  }
};

const runMetricsSnapshot = async () => {
  const start = performance.now();
  try {
    const [queuePending, queueFailed, queueProcessing, cacheTotal] = await Promise.all([
      prisma.newsResolveJob.count({ where: { status: 'PENDING' } }),
      prisma.newsResolveJob.count({ where: { status: 'FAILED' } }),
      prisma.newsResolveJob.count({ where: { status: 'PROCESSING' } }),
      prisma.newsCache.count(),
    ]);

    const durationMs = Math.round(performance.now() - start);
    const snapshot = {
      queue_pending: queuePending,
      queue_failed: queueFailed,
      queue_processing: queueProcessing,
      cache_total: cacheTotal,
      stale_marked_hour: metrics.staleMarkedHour,
      resolved_hour: metrics.resolvedHour,
      rss_upserts_hour: metrics.rssUpsertsHour,
      rearmed_hour: metrics.rearmedHour,
      broken_links_hour: metrics.brokenLinksHour,
      duration_ms: durationMs,
    };

    console.log(`[news-worker] metrics ${JSON.stringify(snapshot)}`);
    resetMetrics();
  } catch (error) {
    console.error('[news-worker] metrics snapshot failed', error);
  }
};

const runPrune = async () => {
  try {
    await pruneExpiredNewsCacheAndOldJobs();
  } catch (error) {
    console.error('[news-worker] prune failed', error);
  }
};

export const startNewsWorker = () => {
  console.log('News worker started.');

  cron.schedule(RSS_REFRESH_CRON, runRssRefresh);
  cron.schedule(ENQUEUE_CRON, runEnqueue);
  cron.schedule(RESOLVE_CRON, runResolve);
  cron.schedule(MARK_OLD_CRON, runMarkOldForRefresh);
  cron.schedule(METRICS_CRON, runMetricsSnapshot);
  cron.schedule(SOURCE_LINK_CHECK_CRON, runSourceLinkHealthCheck);
  cron.schedule(PRUNE_CRON, runPrune);

  void runEnqueue();
  void runResolve();
};

if (require.main === module) {
  startNewsWorker();
}
