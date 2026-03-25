import { describe, expect, it } from 'vitest';
import { isSettingsCallbackData, parseSettingsCallbackData } from '../src/bot/settingsCallbackData';

describe('settings callback data', () => {
  it('parses supported settings actions', () => {
    expect(parseSettingsCallbackData('notify:toggle')).toEqual({ action: 'toggleNotifications' });
    expect(parseSettingsCallbackData('settings:main')).toEqual({ action: 'view', view: 'main' });
    expect(parseSettingsCallbackData('settings:interval')).toEqual({ action: 'view', view: 'interval' });
    expect(parseSettingsCallbackData('settings:limit')).toEqual({ action: 'view', view: 'limit' });
  });

  it('rejects unsupported data', () => {
    expect(isSettingsCallbackData('settings:main')).toBe(true);
    expect(isSettingsCallbackData('settings:weird')).toBe(false);
    expect(parseSettingsCallbackData('settings:weird')).toBeNull();
  });
});
