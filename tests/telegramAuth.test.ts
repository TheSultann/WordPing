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
});
