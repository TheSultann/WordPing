import { Markup } from 'telegraf';
import { type Lang, t } from '../i18n';
import {
  MAX_NOTIFICATION_INTERVAL,
  MAX_NOTIFICATIONS_PER_DAY,
  MIN_NOTIFICATION_INTERVAL,
  MIN_NOTIFICATIONS_PER_DAY,
} from '../services/userService';

export type SettingsView = 'main' | 'interval' | 'limit';

export type SettingsMenuUser = {
  language: string | null;
  notificationsEnabled: boolean;
  notificationIntervalMinutes: number;
  maxNotificationsPerDay: number;
};

export const settingsMainKeyboard = (user: SettingsMenuUser, lang: Lang) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(user.notificationsEnabled ? t(lang, 'btn.notifyOn') : t(lang, 'btn.notifyOff'), 'notify:toggle')],
    [Markup.button.callback(t(lang, 'btn.interval'), 'settings:interval'), Markup.button.callback(t(lang, 'btn.limit'), 'settings:limit')],
  ]);

const renderSettingsMainText = (user: SettingsMenuUser, lang: Lang) =>
  [
    t(lang, 'settings.title'),
    '',
    user.notificationsEnabled ? t(lang, 'settings.notificationsOn') : t(lang, 'settings.notificationsOff'),
    t(lang, 'settings.intervalLine', { value: user.notificationIntervalMinutes }),
    t(lang, 'settings.limitLine', { value: user.maxNotificationsPerDay }),
  ].join('\n');

export const renderSettingsSectionText = (view: SettingsView, user: SettingsMenuUser, lang: Lang) => {
  switch (view) {
    case 'interval':
      return t(lang, 'settings.interval.ask', {
        current: user.notificationIntervalMinutes,
        min: MIN_NOTIFICATION_INTERVAL,
        max: MAX_NOTIFICATION_INTERVAL,
      });
    case 'limit':
      return t(lang, 'settings.limit.ask', {
        current: user.maxNotificationsPerDay,
        min: MIN_NOTIFICATIONS_PER_DAY,
        max: MAX_NOTIFICATIONS_PER_DAY,
      });
    default:
      return renderSettingsMainText(user, lang);
  }
};

export const settingsBackKeyboard = (lang: Lang) =>
  Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'btn.back'), 'settings:main')]]);
