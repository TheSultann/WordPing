import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeHealthReporter, isRuntimeSnapshotReady, readRuntimeHealth } from '../src/utils/runtimeHealth';

const runtimeDir = path.join(process.cwd(), '.runtime');
const waitForStatus = async (
  service: 'worker' | 'news-worker',
  status: 'ok' | 'error',
): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const health = await readRuntimeHealth([service]);
    if (health[service].status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${service} status ${status}`);
};

afterEach(async () => {
  await rm(runtimeDir, { recursive: true, force: true });
});

describe('runtime health', () => {
  it('writes ok heartbeat snapshots', async () => {
    const reporter = createRuntimeHealthReporter('worker');
    reporter.markOk('worker ready');
    await waitForStatus('worker', 'ok');

    const health = await readRuntimeHealth();
    expect(health.worker.status).toBe('ok');
    expect(health.worker.note).toBe('worker ready');
  });

  it('writes error task state', async () => {
    const reporter = createRuntimeHealthReporter('news-worker');
    reporter.markTask('resolve', 'error', 'resolve failed');
    await waitForStatus('news-worker', 'error');

    const health = await readRuntimeHealth();
    expect(health['news-worker'].status).toBe('error');
    expect(health['news-worker'].lastTask?.name).toBe('resolve');
    expect(health['news-worker'].lastTask?.note).toBe('resolve failed');
  });

  it('preserves the latest state when multiple reporters write the same service', async () => {
    const initialReporter = createRuntimeHealthReporter('worker');
    const nextReporter = createRuntimeHealthReporter('worker');

    initialReporter.markOk('worker ready');
    nextReporter.markError('worker failed');
    await waitForStatus('worker', 'error');

    const health = await readRuntimeHealth(['worker']);
    expect(health.worker.status).toBe('error');
    expect(health.worker.note).toBe('worker failed');
  });

  it('treats fresh error snapshots as ready only when explicitly allowed', () => {
    const freshErrorSnapshot = {
      service: 'worker' as const,
      pid: 1,
      startedAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:01:00.000Z',
      state: 'error' as const,
      status: 'error' as const,
      stale: false,
      note: 'worker failed',
    };

    expect(isRuntimeSnapshotReady(freshErrorSnapshot)).toBe(false);
    expect(isRuntimeSnapshotReady(freshErrorSnapshot, { allowFreshError: true })).toBe(true);
  });

  it('never treats stale error snapshots as ready', () => {
    const staleErrorSnapshot = {
      service: 'worker' as const,
      pid: 1,
      startedAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:01:00.000Z',
      state: 'error' as const,
      status: 'error' as const,
      stale: true,
      note: 'worker failed long ago',
    };

    expect(isRuntimeSnapshotReady(staleErrorSnapshot)).toBe(false);
    expect(isRuntimeSnapshotReady(staleErrorSnapshot, { allowFreshError: true })).toBe(false);
  });
});
