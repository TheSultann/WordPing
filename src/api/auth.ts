import crypto from 'crypto';

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type InitDataPayload = {
  hash: string;
  dataCheckString: string;
  authDate?: number;
  authDatePresent: boolean;
  user?: TelegramUser | null;
};

const parseInitData = (initData: string): InitDataPayload => {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') ?? '';

  const data: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key !== 'hash') data[key] = value;
  });

  const dataCheckString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');

  const authDateRaw = data.auth_date ? parseInt(data.auth_date, 10) : undefined;
  let user: TelegramUser | null = null;
  if (data.user) {
    try {
      user = JSON.parse(data.user) as TelegramUser;
    } catch {
      user = null;
    }
  }

  const payload: InitDataPayload = {
    hash,
    dataCheckString,
    authDatePresent: Object.prototype.hasOwnProperty.call(data, 'auth_date'),
    user,
  };

  if (typeof authDateRaw === 'number' && Number.isFinite(authDateRaw)) {
    payload.authDate = authDateRaw;
  }

  return payload;
};

export type VerifyInitDataResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; error: string };

export const verifyInitData = (
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400
): VerifyInitDataResult => {
  if (!initData) return { ok: false, error: 'initData_missing' };
  if (!botToken) return { ok: false, error: 'bot_token_missing' };

  const { hash, dataCheckString, authDate, authDatePresent, user } = parseInitData(initData);
  if (!hash) return { ok: false, error: 'hash_missing' };
  if (!user) return { ok: false, error: 'user_missing' };
  if (!authDatePresent) return { ok: false, error: 'auth_date_missing' };
  if (typeof authDate !== 'number' || !Number.isFinite(authDate)) {
    return { ok: false, error: 'auth_date_invalid' };
  }
  const verifiedAuthDate = authDate;

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const hashBuffer = Buffer.from(hash, 'hex');
  const computedBuffer = Buffer.from(computedHash, 'hex');
  if (hashBuffer.length !== computedBuffer.length) {
    return { ok: false, error: 'hash_length_mismatch' };
  }
  if (!crypto.timingSafeEqual(hashBuffer, computedBuffer)) {
    return { ok: false, error: 'hash_mismatch' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - verifiedAuthDate) > maxAgeSeconds) {
    return { ok: false, error: 'auth_date_expired' };
  }

  return { ok: true, user, authDate: verifiedAuthDate };
};

