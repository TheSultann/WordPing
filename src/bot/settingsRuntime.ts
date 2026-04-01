import type { Context } from 'telegraf';
import { type Lang, t } from '../i18n';
import { resetState, setState } from '../services/sessionService';
import { setNotifications } from '../services/userService';
import { parseSettingsCallbackData } from './settingsCallbackData';
import {
  renderSettingsSectionText,
  settingsBackKeyboard,
  settingsMainKeyboard,
  type SettingsMenuUser,
  type SettingsView,
} from './settingsUi';

type LoadSettingsUser = (ctx: Context, userId: number) => Promise<SettingsMenuUser>;

type SettingsRuntimeOptions = {
  loadUser: LoadSettingsUser;
};

const replySettingsText = async (
  ctx: Context,
  text: string,
  extra?: any,
) => {
  await ctx.reply(text, { parse_mode: 'HTML', ...extra });
};

export const createSettingsRuntime = ({ loadUser }: SettingsRuntimeOptions) => {
  const sendSettings = async (
    ctx: Context,
    userId: number,
    view: SettingsView = 'main',
    edit = false,
  ) => {
    const fresh = await loadUser(ctx, userId);
    const lang = (fresh.language as Lang) || 'ru';
    const text = renderSettingsSectionText(view, fresh, lang);
    const keyboard = view === 'main'
      ? settingsMainKeyboard(fresh, lang)
      : settingsBackKeyboard(lang);

    if (edit && 'editMessageText' in ctx) {
      try {
        await (ctx as any).editMessageText(text, { parse_mode: 'HTML', ...keyboard });
        return;
      } catch {
        // Fall back to reply below.
      }
    }

    await replySettingsText(ctx, text, keyboard);
  };

  const handleSettingsCallback = async (
    ctx: Context,
    userId: number,
    data: string,
  ) => {
    const parsed = parseSettingsCallbackData(data);
    if (!parsed) return;

    const user = await loadUser(ctx, userId);
    const lang = (user.language as Lang) || 'ru';

    if (parsed.action === 'toggleNotifications') {
      await setNotifications(userId, !user.notificationsEnabled);
      await resetState(BigInt(userId));
      await ctx.answerCbQuery(t(lang, 'notify.toggled'));
      await sendSettings(ctx, userId, 'main', true);
      return;
    }

    if (parsed.view === 'interval') {
      await resetState(BigInt(userId));
      await setState(BigInt(userId), 'SETTINGS_WAIT_INTERVAL');
      await ctx.answerCbQuery();
      await replySettingsText(ctx, renderSettingsSectionText('interval', user, lang));
      return;
    }

    if (parsed.view === 'limit') {
      await resetState(BigInt(userId));
      await setState(BigInt(userId), 'SETTINGS_WAIT_GOAL');
      await ctx.answerCbQuery();
      await replySettingsText(ctx, renderSettingsSectionText('limit', user, lang));
      return;
    }

    await resetState(BigInt(userId));
    await sendSettings(ctx, userId, 'main', true);
    await ctx.answerCbQuery();
  };

  return {
    handleSettingsCallback,
    sendSettings,
  };
};
