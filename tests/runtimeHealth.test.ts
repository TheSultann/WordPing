import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeHealthReporter, readRuntimeHealth } from '../src/utils/runtimeHealth';

const runtimeDir = path.join(process.cwd(), '.runtime');
const waitForWrite = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 25));
};

afterEach(async () => {
  await rm(runtimeDir, { recursive: true, force: true });
});

describe('runtime health', () => {
  it('writes ok heartbeat snapshots', async () => {
    const reporter = createRuntimeHealthReporter('worker');
    reporter.markOk('worker ready');
    await waitForWrite();

    const health = await readRuntimeHealth();
    expect(health.worker.status).toBe('ok');
    expect(health.worker.note).toBe('worker ready');
  });

  it('writes error task state', async () => {
    const reporter = createRuntimeHealthReporter('news-worker');
    reporter.markTask('resolve', 'error', 'resolve failed');
    await waitForWrite();

    const health = await readRuntimeHealth();
    expect(health['news-worker'].status).toBe('error');
    expect(health['news-worker'].lastTask?.name).toBe('resolve');
    expect(health['news-worker'].lastTask?.note).toBe('resolve failed');
  });
});
