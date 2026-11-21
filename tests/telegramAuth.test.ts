import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { verifyInitData } from '../src/api/auth';

type InitPayload = Record<string, string>;

const buildInitData = (botToken: string, payload: InitPayload) => {
  const dataCheckString = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const params = new URLSearchParams({ ...payload, hash });
  return params.toString();
};

describe('verifyInitData', () => {
  const botToken = '123456:ABCDEF_fake_token';

  it('accepts valid initData', () => {
    const user = { id: 42, first_name: 'Test' };
    const payload = {
      auth_date: `${Math.floor(Date.now() / 1000)}`,
      user: JSON.stringify(user),
      query_id: 'AAEAAQ',
    };
    const initData = buildInitData(botToken, payload);
    const result = verifyInitData(initData, botToken, 86400);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(42);
    }
  });

  it('rejects invalid hash', () => {
    const payload = {
      auth_date: `${Math.floor(Date.now() / 1000)}`,
      user: JSON.stringify({ id: 1 }),
    };
    const initData = new URLSearchParams({ ...payload, hash: 'bad' }).toString();
    const result = verifyInitData(initData, botToken, 86400);
    expect(result.ok).toBe(false);
  });

  it('rejects expired auth_date', () => {
    const payload = {
      auth_date: '1',
      user: JSON.stringify({ id: 1 }),
    };
    const initData = buildInitData(botToken, payload);
    const result = verifyInitData(initData, botToken, 10);
    expect(result.ok).toBe(false);
  });

  it('rejects invalid user JSON', () => {
    const payload = {
      auth_date: `${Math.floor(Date.now() / 1000)}`,
      user: '{not_json}',
    };
    const initData = buildInitData(botToken, payload);
    const result = verifyInitData(initData, botToken, 86400);
    expect(result.ok).toBe(false);
  });

  it('rejects missing auth_date', () => {
    const payload = {
      user: JSON.stringify({ id: 1 }),
      query_id: 'AAEAAQ',
    };
    const initData = buildInitData(botToken, payload);
    const result = verifyInitData(initData, botToken, 86400);
    expect(result).toEqual({ ok: false, error: 'auth_date_missing' });
  });

  it('rejects invalid auth_date', () => {
    const payload = {
      auth_date: 'not-a-number',
      user: JSON.stringify({ id: 1 }),
      query_id: 'AAEAAQ',
    };
    const initData = buildInitData(botToken, payload);
    const result = verifyInitData(initData, botToken, 86400);
    expect(result).toEqual({ ok: false, error: 'auth_date_invalid' });
  });

  it('rejects empty initData', () => {
    const result = verifyInitData('', botToken, 86400);
    expect(result).toEqual({ ok: false, error: 'initData_missing' });
  });

  it('rejects empty botToken', () => {
    const user = { id: 42, first_name: 'Test' };
    const payload = {
      auth_date: `${Math.floor(Date.now() / 1000)}`,
      user: JSON.stringify(user),
    };
    const initData = buildInitData(botToken, payload);
    const result = verifyInitData(initData, '', 86400);
    expect(result).toEqual({ ok: false, error: 'bot_token_missing' });
  });

  it('rejects missing hash', () => {
    const params = new URLSearchParams({
      auth_date: `${Math.floor(Date.now() / 1000)}`,
      user: JSON.stringify({ id: 1 }),
    });
    const result = verifyInitData(params.toString(), botToken, 86400);
    expect(result).toEqual({ ok: false, error: 'hash_missing' });
  });

  it('rejects hash with wrong length', () => {
    const payload = {
      auth_date: `${Math.floor(Date.now() / 1000)}`,
      user: JSON.stringify({ id: 1 }),
    };
    const params = new URLSearchParams({ ...payload, hash: 'aabbcc' });
    const result = verifyInitData(params.toString(), botToken, 86400);
    expect(result.ok).toBe(false);
  });

  it('accepts short maxAgeSeconds (1 hour) for fresh auth', () => {
    const user = { id: 99, first_name: 'Fresh' };
    const payload = {
      auth_date: `${Math.floor(Date.now() / 1000)}`,
      user: JSON.stringify(user),
    };
    const initData = buildInitData(botToken, payload);
    const result = verifyInitData(initData, botToken, 3600);
    expect(result.ok).toBe(true);
  });

  it('rejects with short maxAgeSeconds when auth is 2 hours old', () => {
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 7200;
    const payload = {
      auth_date: `${twoHoursAgo}`,
      user: JSON.stringify({ id: 1 }),
    };
    const initData = buildInitData(botToken, payload);
    const result = verifyInitData(initData, botToken, 3600);
    expect(result).toEqual({ ok: false, error: 'auth_date_expired' });
  });

  it('rejects missing user', () => {
    const payload = {
      auth_date: `${Math.floor(Date.now() / 1000)}`,
      query_id: 'AAEAAQ',
    };
    const initData = buildInitData(botToken, payload);
    const result = verifyInitData(initData, botToken, 86400);
    expect(result).toEqual({ ok: false, error: 'user_missing' });
  });
});
