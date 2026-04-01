import cron from 'node-cron';

export const trimEnv = (value: string | undefined): string => (value ?? '').trim();

export type RuntimeService = 'api' | 'bot' | 'worker' | 'news-worker';

const BOOLEAN_VALUES = new Set(['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off']);
const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const LOG_LEVEL_VALUES = new Set(['debug', 'info', 'warn', 'error']);
const LOG_FORMAT_VALUES = new Set(['pretty', 'json']);

const readEnv = (key: string): string => trimEnv(process.env[key]);

const pushMissing = (errors: string[], key: string): void => {
  if (!readEnv(key)) {
    errors.push(`${key} is not set`);
  }
};

const validateIntegerEnv = (
  errors: string[],
  key: string,
  options: { min?: number; max?: number } = {},
): void => {
  const raw = readEnv(key);
  if (!raw) return;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || `${value}` !== raw) {
    errors.push(`${key} must be an integer`);
    return;
  }
  if (options.min !== undefined && value < options.min) {
    errors.push(`${key} must be >= ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    errors.push(`${key} must be <= ${options.max}`);
  }
};

const validateBooleanEnv = (errors: string[], key: string): void => {
  const raw = readEnv(key).toLowerCase();
  if (!raw) return;
  if (!BOOLEAN_VALUES.has(raw)) {
    errors.push(`${key} must be a boolean-like value`);
  }
};

const isEnabledBooleanEnv = (key: string): boolean => {
  const raw = readEnv(key).toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

const validateEnumEnv = (errors: string[], key: string, allowed: Set<string>): void => {
  const raw = readEnv(key).toLowerCase();
  if (!raw) return;
  if (!allowed.has(raw)) {
    errors.push(`${key} must be one of: ${Array.from(allowed).join(', ')}`);
  }
};

const validateBigIntEnv = (errors: string[], key: string): void => {
  const raw = readEnv(key);
  if (!raw) return;
  if (!/^\d+$/.test(raw)) {
    errors.push(`${key} must be a positive integer`);
    return;
  }
  try {
    if (BigInt(raw) <= 0n) {
      errors.push(`${key} must be > 0`);
    }
  } catch {
    errors.push(`${key} must be a valid bigint`);
  }
};

const validateUrlEnv = (
  errors: string[],
  key: string,
  options: {
    requireHttpsInProduction?: boolean;
    allowHttp?: boolean;
    allowedProtocols?: Set<string>;
  } = {},
): void => {
  const raw = readEnv(key);
  if (!raw) return;
  try {
    const url = new URL(raw);
    if (options.allowedProtocols && !options.allowedProtocols.has(url.protocol)) {
      errors.push(`${key} has unsupported protocol`);
    }
    if (options.allowHttp === false && url.protocol !== 'https:') {
      errors.push(`${key} must use https://`);
    }
    if (options.requireHttpsInProduction && process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      errors.push(`${key} must use https:// in production`);
    }
  } catch {
    errors.push(`${key} must be a valid URL`);
  }
};

const validateOriginListEnv = (errors: string[], key: string): void => {
  const raw = readEnv(key);
  if (!raw) return;
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  for (const origin of parts) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.push(`${key} must contain only http(s) origins`);
        return;
      }
    } catch {
      errors.push(`${key} must contain only valid URLs`);
      return;
    }
  }
};

const validateCronEnv = (errors: string[], key: string): void => {
  const raw = readEnv(key);
  if (!raw) return;
  const validate = (cron as { validate?: (expression: string) => boolean }).validate;
  if (typeof validate !== 'function') return;
  if (!validate(raw)) {
    errors.push(`${key} must be a valid cron expression`);
  }
};

export const validateRuntimeEnv = (service: RuntimeService): void => {
  const errors: string[] = [];

  validateEnumEnv(errors, 'LOG_LEVEL', LOG_LEVEL_VALUES);
  validateEnumEnv(errors, 'LOG_FORMAT', LOG_FORMAT_VALUES);

  pushMissing(errors, 'DATABASE_URL');
  validateUrlEnv(errors, 'DATABASE_URL', { allowedProtocols: POSTGRES_PROTOCOLS });

  if (service === 'api' || service === 'bot' || service === 'worker') {
    pushMissing(errors, 'BOT_TOKEN');
  }

  if (service === 'api') {
    validateIntegerEnv(errors, 'API_PORT', { min: 1, max: 65535 });
    validateIntegerEnv(errors, 'INIT_DATA_MAX_AGE_SECONDS', { min: 1 });
    validateBooleanEnv(errors, 'ALLOW_DEV_AUTH');
    pushMissing(errors, 'ADMIN_TELEGRAM_ID');
    validateBigIntEnv(errors, 'ADMIN_TELEGRAM_ID');
    validateOriginListEnv(errors, 'WEB_ORIGIN');
    if (process.env.NODE_ENV === 'production' && isEnabledBooleanEnv('ALLOW_DEV_AUTH')) {
      errors.push('ALLOW_DEV_AUTH must be disabled in production');
    }
  }

  if (service === 'bot') {
    validateUrlEnv(errors, 'WEBAPP_URL', { requireHttpsInProduction: true });
  }

  if (service === 'worker') {
    validateIntegerEnv(errors, 'FILL_SENTENCES_URGENT_WINDOW_MINUTES', { min: 1 });
  }

  if (service === 'news-worker') {
    validateCronEnv(errors, 'NEWS_RSS_REFRESH_CRON');
    validateCronEnv(errors, 'NEWS_ENQUEUE_CRON');
    validateCronEnv(errors, 'NEWS_RESOLVE_CRON');
    validateCronEnv(errors, 'NEWS_MARK_OLD_CRON');
    validateCronEnv(errors, 'NEWS_METRICS_CRON');
    validateCronEnv(errors, 'NEWS_SOURCE_LINK_CHECK_CRON');
    validateCronEnv(errors, 'NEWS_PRUNE_CRON');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid env for ${service}:\n- ${errors.join('\n- ')}`);
  }
};
