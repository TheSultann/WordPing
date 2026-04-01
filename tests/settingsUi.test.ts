import { describe, expect, it } from 'vitest';
import { renderSettingsSectionText, settingsBackKeyboard, settingsMainKeyboard } from '../src/bot/settingsUi';
import { t } from '../src/i18n';

const user = {
  language: 'ru',
  notificationsEnabled: true,
  notificationIntervalMinutes: 30,
  maxNotificationsPerDay: 20,
} as const;

describe('settings ui', () => {
  it('renders main settings text and buttons', () => {
    const text = renderSettingsSectionText('main', user, 'ru');
    const keyboard = settingsMainKeyboard(user, 'ru');

    expect(text).toContain(t('ru', 'settings.title'));
    expect(text).toContain(t('ru', 'settings.intervalLine', { value: 30 }));
    expect(text).toContain(t('ru', 'settings.limitLine', { value: 20 }));
    expect(keyboard.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data))).toEqual([
      ['notify:toggle'],
      ['settings:interval', 'settings:limit'],
    ]);
  });

  it('renders section texts and back button', () => {
    expect(renderSettingsSectionText('interval', user, 'ru')).toContain(t('ru', 'settings.interval.ask').split('{')[0]!);
    expect(renderSettingsSectionText('limit', user, 'ru')).toContain(t('ru', 'settings.limit.ask').split('{')[0]!);
    expect(settingsBackKeyboard('ru').reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe('settings:main');
  });
});
