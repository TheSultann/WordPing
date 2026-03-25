import { Markup } from 'telegraf';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import {
  ADD_CANCEL_CALLBACK,
  ADD_CHANGE_CALLBACK,
  ADD_CHANGE_TRANSLATION_CALLBACK,
  ADD_CHANGE_WORD_CALLBACK,
  ADD_CONFIRM_CALLBACK,
} from './addConfirmCallbackData';

export const addConfirmKeyboard = (lang: Lang) => Markup.inlineKeyboard([
  [
    Markup.button.callback(t(lang, 'btn.confirmOk'), ADD_CONFIRM_CALLBACK),
    Markup.button.callback(t(lang, 'btn.confirmEdit'), ADD_CHANGE_CALLBACK),
  ],
  [Markup.button.callback(t(lang, 'btn.cancel'), ADD_CANCEL_CALLBACK)],
]);

export const addConfirmEditChoiceKeyboard = (lang: Lang) => Markup.inlineKeyboard([
  [
    Markup.button.callback(t(lang, 'btn.editWord'), ADD_CHANGE_WORD_CALLBACK),
    Markup.button.callback(t(lang, 'btn.editTranslation'), ADD_CHANGE_TRANSLATION_CALLBACK),
  ],
  [Markup.button.callback(t(lang, 'btn.cancel'), ADD_CANCEL_CALLBACK)],
]);
