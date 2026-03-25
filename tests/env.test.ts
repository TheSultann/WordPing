import { afterEach, describe, expect, it } from 'vitest';
import { validateRuntimeEnv } from '../src/utils/env';

const envBackup = { ...process.env };

afterEach(() => {
  process.env = { ...envBackup };
});

describe('runtime env validation', () => {
  it('throws when BOT_TOKEN is missing for bot', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/wordping';
    delete process.env.BOT_TOKEN;

    expect(() => validateRuntimeEnv('bot')).toThrow('BOT_TOKEN is not set');
  });

  it('throws when API_PORT is invalid', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/wordping';
    process.env.BOT_TOKEN = 'test-token';
    process.env.API_PORT = 'abc';

    expect(() => validateRuntimeEnv('api')).toThrow('API_PORT must be an integer');
  });

  it('throws when news cron is invalid', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/wordping';
    process.env.NEWS_RESOLVE_CRON = 'bad-cron';

    expect(() => validateRuntimeEnv('news-worker')).toThrow('NEWS_RESOLVE_CRON must be a valid cron expression');
  });

  it('allows a valid worker config', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/wordping';
    process.env.BOT_TOKEN = 'test-token';
    process.env.FILL_SENTENCES_URGENT_WINDOW_MINUTES = '180';

    expect(() => validateRuntimeEnv('worker')).not.toThrow();
  });
});
