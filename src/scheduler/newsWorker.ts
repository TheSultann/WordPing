import 'dotenv/config';
import cron from 'node-cron';
import { prisma } from '../db/client';
import { validateRuntimeEnv } from '../utils/env';
import { createLogger } from '../utils/logger';
import { createRuntimeHealthReporter } from '../utils/runtimeHealth';
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

validateRuntimeEnv('news-worker');
const newsWorkerLogger = createLogger('news-worker');
const newsWorkerHealth = createRuntimeHealthReporter('news-worker');

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
      newsWorkerLogger.info('rearmed exhausted jobs', { rearmed });
    }
    if (enqueued > 0) {
      newsWorkerLogger.info('enqueued words', { enqueued, durationMs: Math.round(durationMs) });
    }
    newsWorkerHealth.markTask('enqueue', 'ok');
  } catch (error) {
    newsWorkerHealth.markTask('enqueue', 'error', error instanceof Error ? error.message : 'enqueue failed');
    newsWorkerLogger.error('enqueue failed', { error });
  }
};

const runRssRefresh = async () => {
  try {
    const start = performance.now();
    const processed = await refreshNewsCacheFromRss();
    const durationMs = performance.now() - start;
    if (processed.totalProcessed > 0) {
      metrics.rssUpsertsHour += processed.totalProcessed;
      newsWorkerLogger.info('rss cache updated', {
        inserted: processed.inserted,
        updated: processed.updated,
        totalProcessed: processed.totalProcessed,
        durationMs: Math.round(durationMs),
      });
    }
    newsWorkerHealth.markTask('rss-refresh', 'ok');
  } catch (error) {
    newsWorkerHealth.markTask('rss-refresh', 'error', error instanceof Error ? error.message : 'rss refresh failed');
    newsWorkerLogger.error('rss refresh failed', { error });
  }
};

const runResolve = async () => {
  try {
    const start = performance.now();
    const result = await resolvePendingNewsExamples();
    const durationMs = performance.now() - start;
    if (result.claimed > 0) {
      metrics.resolvedHour += result.resolved;
      newsWorkerLogger.info('resolve cycle completed', {
        claimed: result.claimed,
        resolved: result.resolved,
        failed: result.failed,
        deferred: result.deferred,
        durationMs: Math.round(durationMs),
      });
    }
    newsWorkerHealth.markTask('resolve', 'ok');
  } catch (error) {
    newsWorkerHealth.markTask('resolve', 'error', error instanceof Error ? error.message : 'resolve failed');
    newsWorkerLogger.error('resolve cycle failed', { error });
  }
};

const runMarkOldForRefresh = async () => {
  try {
    const start = performance.now();
    const marked = await markOldNewsForRefresh();
    const durationMs = performance.now() - start;
    metrics.staleMarkedHour += marked;
    if (marked > 0) {
      newsWorkerLogger.info('marked stale news for refresh', { marked, durationMs: Math.round(durationMs) });
    }
    newsWorkerHealth.markTask('mark-old', 'ok');
  } catch (error) {
    newsWorkerHealth.markTask('mark-old', 'error', error instanceof Error ? error.message : 'mark-old failed');
    newsWorkerLogger.error('mark-old-for-refresh failed', { error });
  }
};

const runSourceLinkHealthCheck = async () => {
  try {
    const start = performance.now();
    const marked = await markBrokenNewsSourcesForRefresh();
    const durationMs = performance.now() - start;
    metrics.brokenLinksHour += marked;
    if (marked > 0) {
      newsWorkerLogger.info('broken source links marked for refresh', { marked, durationMs: Math.round(durationMs) });
    }
    newsWorkerHealth.markTask('source-link-check', 'ok');
  } catch (error) {
    newsWorkerHealth.markTask('source-link-check', 'error', error instanceof Error ? error.message : 'source link check failed');
    newsWorkerLogger.error('source link health-check failed', { error });
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

    newsWorkerLogger.info('metrics snapshot', snapshot);
    resetMetrics();
    newsWorkerHealth.markTask('metrics', 'ok');
  } catch (error) {
    newsWorkerHealth.markTask('metrics', 'error', error instanceof Error ? error.message : 'metrics failed');
    newsWorkerLogger.error('metrics snapshot failed', { error });
  }
};

const runPrune = async () => {
  try {
    await pruneExpiredNewsCacheAndOldJobs();
    newsWorkerHealth.markTask('prune', 'ok');
  } catch (error) {
    newsWorkerHealth.markTask('prune', 'error', error instanceof Error ? error.message : 'prune failed');
    newsWorkerLogger.error('prune failed', { error });
  }
};

export const startNewsWorker = () => {
  newsWorkerHealth.start();
  newsWorkerHealth.markOk('news worker started');
  newsWorkerLogger.info('news worker started', {
    rssRefreshCron: RSS_REFRESH_CRON,
    enqueueCron: ENQUEUE_CRON,
    resolveCron: RESOLVE_CRON,
    markOldCron: MARK_OLD_CRON,
    metricsCron: METRICS_CRON,
    sourceLinkCheckCron: SOURCE_LINK_CHECK_CRON,
    pruneCron: PRUNE_CRON,
  });

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
