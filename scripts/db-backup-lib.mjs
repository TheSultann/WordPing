import path from 'node:path';

export const DEFAULT_BACKUP_DIR = path.join(process.cwd(), 'backups', 'postgres');
export const DEFAULT_BACKUP_PREFIX = 'wordping-db';
export const DEFAULT_BACKUP_RETENTION_COUNT = 14;
export const DEFAULT_TELEGRAM_BOT_API_BASE_URL = 'https://api.telegram.org';
export const DEFAULT_TELEGRAM_CLOUD_UPLOAD_LIMIT_MB = 50;
export const DEFAULT_TELEGRAM_LOCAL_UPLOAD_LIMIT_MB = 2000;

export const normalizePositiveInteger = (value, fallback, options = {}) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < (options.min ?? 1)) return fallback;
  if (options.max !== undefined && parsed > options.max) return fallback;
  return parsed;
};

export const formatBackupTimestamp = (date = new Date()) =>
  date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export const buildBackupFileName = (prefix = DEFAULT_BACKUP_PREFIX, date = new Date()) =>
  `${prefix}-${formatBackupTimestamp(date)}.dump`;

export const isManagedBackupFile = (fileName, prefix = DEFAULT_BACKUP_PREFIX) =>
  fileName.startsWith(`${prefix}-`) && fileName.endsWith('.dump');

export const normalizeBotApiBaseUrl = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_TELEGRAM_BOT_API_BASE_URL;
  return raw.replace(/\/+$/, '');
};

export const isDefaultTelegramBotApiBaseUrl = (value) =>
  normalizeBotApiBaseUrl(value) === DEFAULT_TELEGRAM_BOT_API_BASE_URL;

export const resolveTelegramUploadLimitMb = (rawValue, botApiBaseUrl) => {
  const fallback = isDefaultTelegramBotApiBaseUrl(botApiBaseUrl)
    ? DEFAULT_TELEGRAM_CLOUD_UPLOAD_LIMIT_MB
    : DEFAULT_TELEGRAM_LOCAL_UPLOAD_LIMIT_MB;

  return normalizePositiveInteger(rawValue, fallback, { min: 1, max: 10000 });
};

export const megabytesToBytes = (value) => Math.max(0, Math.floor(Number(value) * 1024 * 1024));

export const selectBackupFilesToPrune = (files, keepCount) =>
  [...files]
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(Math.max(keepCount, 0));
