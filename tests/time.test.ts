import { describe, expect, it } from 'vitest';
import dayjs, {
  isWithinWindow,
  minutesToTimeString,
  parseTimeString,
} from '../src/utils/time';

describe('time utils', () => {
  it('minutesToTimeString formats correctly', () => {
    expect(minutesToTimeString(0)).toBe('00:00');
    expect(minutesToTimeString(60)).toBe('01:00');
    expect(minutesToTimeString(1439)).toBe('23:59');
    expect(minutesToTimeString(-60)).toBe('23:00');
  });

  it('parseTimeString parses valid values', () => {
    expect(parseTimeString('09:30')).toBe(570);
    expect(parseTimeString('23:59')).toBe(1439);
    expect(parseTimeString('24:00')).toBeNull();
  });

  it('isWithinWindow handles overnight windows', () => {
    const late = dayjs('2024-01-01T23:00:00');
    const early = dayjs('2024-01-01T07:00:00');
    const midday = dayjs('2024-01-01T12:00:00');
    expect(isWithinWindow(late, 1320, 480)).toBe(true); // 22:00-08:00
    expect(isWithinWindow(early, 1320, 480)).toBe(true);
    expect(isWithinWindow(midday, 1320, 480)).toBe(false);
  });

  it('isWithinWindow returns true for 24/7', () => {
    const t = dayjs('2024-01-01T12:00:00');
    expect(isWithinWindow(t, 0, 0)).toBe(true);
  });
});
