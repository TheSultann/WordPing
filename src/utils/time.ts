import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// Use UTC by default so new users without tz не сдвигают окна уведомлений.
export const DEFAULT_TIMEZONE = 'UTC';

const UTC_LIKE = new Set([
  'utc',
  'etc/utc',
  'gmt',
  'etc/gmt',
  'etc/gmt+0',
  'etc/gmt-0',
]);

const resolveTimezone = (tz?: string | null): string => {
  const value = (tz ?? '').trim();
  if (!value) return DEFAULT_TIMEZONE;
  if (UTC_LIKE.has(value.toLowerCase())) return DEFAULT_TIMEZONE;
  return value.length > 0 ? value : DEFAULT_TIMEZONE;
};

export const nowUtc = (): Dayjs => dayjs().utc();
export const toUtcDate = (d: Dayjs): Date => d.toDate();

export const userNow = (tz?: string | null): Dayjs => {
  const zone = resolveTimezone(tz);
  try {
    return dayjs().tz(zone);
  } catch (e) {
    return dayjs().tz(DEFAULT_TIMEZONE);
  }
};

export const toUserTime = (date: Date | Dayjs, tz?: string | null): Dayjs => {
  const base = dayjs.isDayjs(date) ? date : dayjs(date);
  const zone = resolveTimezone(tz);
  try {
    return base.tz(zone);
  } catch (e) {
    return base.tz(DEFAULT_TIMEZONE);
  }
};

export const isWithinWindow = (local: Dayjs, startMinutes: number, endMinutes: number): boolean => {
  const minutes = local.hour() * 60 + local.minute();
  if (startMinutes === endMinutes) return true; // always on
  if (startMinutes < endMinutes) {
    return minutes >= startMinutes && minutes < endMinutes;
  }
  return minutes >= startMinutes || minutes < endMinutes;
};

export const startOfUserDay = (tz?: string | null, at?: Dayjs): Dayjs => {
  const base = at ? toUserTime(at, tz) : userNow(tz);
  return base.startOf('day');
};

export const minutesToTimeString = (minutes: number): string => {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
};

export const parseTimeString = (value: string): number | null => {
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  return hours * 60 + minutes;
};

export const diffInDays = (a: Dayjs, b: Dayjs): number => {
  return a.startOf('day').diff(b.startOf('day'), 'day');
};

export const addMinutes = (date: Dayjs, minutes: number): Dayjs => date.add(minutes, 'minute');

export const formatDateTime = (date: Date | Dayjs, tz?: string | null): string => {
  const d = dayjs.isDayjs(date) ? date : dayjs(date);
  const zone = resolveTimezone(tz);
  const local = d.tz(zone as string);
  return local.format('YYYY-MM-DD HH:mm');
};

export default dayjs;
