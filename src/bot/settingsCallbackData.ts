import type { SettingsView } from './settingsUi';

export type SettingsCallbackAction =
  | { action: 'view'; view: SettingsView }
  | { action: 'toggleNotifications' };

export const isSettingsCallbackData = (data: string): boolean =>
  data === 'notify:toggle' ||
  data === 'settings:main' ||
  data === 'settings:interval' ||
  data === 'settings:limit';

export const parseSettingsCallbackData = (data: string): SettingsCallbackAction | null => {
  switch (data) {
    case 'notify:toggle':
      return { action: 'toggleNotifications' };
    case 'settings:main':
      return { action: 'view', view: 'main' };
    case 'settings:interval':
      return { action: 'view', view: 'interval' };
    case 'settings:limit':
      return { action: 'view', view: 'limit' };
    default:
      return null;
  }
};
