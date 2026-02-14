import { afterEach, describe, expect, it, vi } from 'vitest';

const envBackup = { ...process.env };

afterEach(() => {
  process.env = { ...envBackup };
  vi.resetModules();
});

describe('worker bootstrap', () => {
  it('throws when BOT_TOKEN is missing', async () => {
    delete process.env.BOT_TOKEN;
    vi.resetModules();

    await expect(import('../src/scheduler/worker')).rejects.toThrow('BOT_TOKEN is not set');
  });
});
