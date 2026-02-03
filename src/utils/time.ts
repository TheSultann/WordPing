import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const nowUtc = (): Dayjs => dayjs().utc();
export const toUtcDate = (d: Dayjs): Date => d.toDate();

export const userNow = (tz?: string | null): Dayjs => {
  if (tz) {
    try {
      return dayjs().tz(tz as string);
    } catch (e) {
      return dayjs().utc();
    }
  }
  return dayjs().utc();
};

export const toUserTime = (date: Date | Dayjs, tz?: string | null): Dayjs => {
  const base = dayjs.isDayjs(date) ? date : dayjs(date);
  if (tz) {
    try {
      return base.tz(tz as string);
    } catch (e) {
      return base.utc();
    }
  }
  return base.utc();
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
  const zone = tz ?? 'UTC';
  const local = zone ? d.tz(zone as string) : d.utc();
  return local.format('YYYY-MM-DD HH:mm');
};

export default dayjs;
