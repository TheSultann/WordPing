import { describe, expect, it } from 'vitest';
import {
  buildBackupFileName,
  DEFAULT_TELEGRAM_CLOUD_UPLOAD_LIMIT_MB,
  DEFAULT_TELEGRAM_LOCAL_UPLOAD_LIMIT_MB,
  formatBackupTimestamp,
  megabytesToBytes,
  normalizePositiveInteger,
  resolveTelegramUploadLimitMb,
  selectBackupFilesToPrune,
} from '../scripts/db-backup-lib.mjs';

describe('db backup scripts', () => {
  it('builds stable backup file names', () => {
    const date = new Date('2026-03-19T17:27:00.000Z');
    expect(formatBackupTimestamp(date)).toBe('20260319T172700Z');
    expect(buildBackupFileName('wordping-db', date)).toBe('wordping-db-20260319T172700Z.dump');
  });

  it('uses fallback retention for bad values', () => {
    expect(normalizePositiveInteger('14', 7, { min: 1, max: 30 })).toBe(14);
    expect(normalizePositiveInteger('0', 7, { min: 1, max: 30 })).toBe(7);
    expect(normalizePositiveInteger('500', 7, { min: 1, max: 30 })).toBe(7);
    expect(normalizePositiveInteger('abc', 7, { min: 1, max: 30 })).toBe(7);
  });

  it('prunes oldest backups after retention limit', () => {
    const files = [
      { name: 'a.dump', mtimeMs: 100 },
      { name: 'b.dump', mtimeMs: 300 },
      { name: 'c.dump', mtimeMs: 200 },
      { name: 'd.dump', mtimeMs: 50 },
    ];

    expect(selectBackupFilesToPrune(files, 2).map((file) => file.name)).toEqual(['a.dump', 'd.dump']);
  });

  it('uses Telegram cloud upload limit by default', () => {
    expect(resolveTelegramUploadLimitMb(undefined, 'https://api.telegram.org')).toBe(
      DEFAULT_TELEGRAM_CLOUD_UPLOAD_LIMIT_MB,
    );
    expect(megabytesToBytes(DEFAULT_TELEGRAM_CLOUD_UPLOAD_LIMIT_MB)).toBe(50 * 1024 * 1024);
  });

  it('uses larger default limit for local Bot API server', () => {
    expect(resolveTelegramUploadLimitMb(undefined, 'http://127.0.0.1:8081')).toBe(
      DEFAULT_TELEGRAM_LOCAL_UPLOAD_LIMIT_MB,
    );
  });

  it('prefers explicit Telegram upload limit when configured', () => {
    expect(resolveTelegramUploadLimitMb('128', 'https://api.telegram.org')).toBe(128);
  });
});
