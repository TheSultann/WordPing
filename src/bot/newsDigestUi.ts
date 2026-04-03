import { Markup } from 'telegraf';
import type { Lang } from '../i18n';
import type { NewsDigestItem } from '../services/newsFallbackService';
import { escapeHtml } from '../utils/html';
import {
  NEWS_NAV_MORE_CALLBACK,
  NEWS_NAV_NEXT_CALLBACK,
  NEWS_NAV_NOOP_CALLBACK,
  NEWS_NAV_PREV_CALLBACK,
} from './newsDigestCallbackData';

const NEWS_DIGEST_CARD_TITLE_BY_LANG: Record<Lang, string> = {
  ru: '\u{1F4F0} \u041D\u043E\u0432\u043E\u0441\u0442\u044C \u0434\u043D\u044F',
  uz: '\u{1F4F0} Kun yangiligi',
};

const NEWS_READ_FULL_LABEL_BY_LANG: Record<Lang, string> = {
  ru: '\u0427\u0438\u0442\u0430\u0442\u044C \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B',
  uz: 'To\u2018liq o\u2018qish',
};

const NEWS_SOURCE_LABEL_BY_LANG: Record<Lang, string> = {
  ru: '\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A',
  uz: 'Manba',
};

const NEWS_DIGEST_STALE_TEXT_BY_LANG: Record<Lang, string> = {
  ru: '\u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442 \u0443\u0441\u0442\u0430\u0440\u0435\u043B, \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043D\u043E\u0432\u043E\u0441\u0442\u0438 \u0441\u043D\u043E\u0432\u0430',
  uz: 'Dayjest eskirdi, yangiliklarni qayta oching',
};

const NEWS_NAV_PREV_LABEL_BY_LANG: Record<Lang, string> = {
  ru: '\u2B05\uFE0F',
  uz: '\u2B05\uFE0F',
};

const NEWS_NAV_NEXT_LABEL_BY_LANG: Record<Lang, string> = {
  ru: '\u27A1\uFE0F',
  uz: '\u27A1\uFE0F',
};

export const NEWS_DIGEST_BUTTON_BY_LANG: Record<Lang, string> = {
  ru: '\u{1F4F0} \u041F\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043D\u043E\u0432\u043E\u0441\u0442\u0438',
  uz: '\u{1F4F0} Yangiliklarni o\u2018qish',
};

export const NEWS_DIGEST_BUTTONS = Object.values(NEWS_DIGEST_BUTTON_BY_LANG);
export const NEWS_DIGEST_BATCH_SIZE = 5;

export type NewsDigestNavItem = Pick<
  NewsDigestItem,
  'wordId' | 'wordEn' | 'translation' | 'highlightedText' | 'sourceUrl' | 'sourceTitle'
>;

export type NewsDigestBatchState = {
  safeTotal: number;
  safeIndex: number;
  batchStart: number;
  batchSize: number;
  batchPosition: number;
  remainingAfterBatch: number;
};

const newsNavMoreLabel = (lang: Lang, count: number, counter: string): string =>
  lang === 'uz'
    ? `\u{1F4DA} Yana ${count} ta ko'rish \u2022 ${counter}`
    : `\u{1F4DA} \u0415\u0449\u0451 ${count} \u2022 ${counter}`;

const newsDigestBatchCounterText = (position: number, size: number): string => `${position}/${size}`;
const newsDigestOverallCounterText = (index: number, total: number): string => `${index + 1}/${total}`;

export const newsDigestFallbackText = (lang: Lang, guideLinkText: string): string => {
  if (lang === 'uz') {
    return `\u{1F4F0} <b>Yangiliklar hozircha mavjud emas</b>

So'zlar Stage 4 ga yetganda yangiliklarda paydo bo'ladi.
Eslatmalarga javob berishda davom eting! \u{1F4AA}

\u{1F4C8} ${guideLinkText}`;
  }

  return `\u{1F4F0} <b>\u041D\u043E\u0432\u043E\u0441\u0442\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B</b>

\u0421\u043B\u043E\u0432\u0430 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0432 \u043D\u043E\u0432\u043E\u0441\u0442\u044F\u0445, \u043A\u043E\u0433\u0434\u0430 \u0434\u043E\u0441\u0442\u0438\u0433\u043D\u0443\u0442 Stage 4.
\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0439 \u043E\u0442\u0432\u0435\u0447\u0430\u0442\u044C \u043D\u0430 \u043D\u0430\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u044F! \u{1F4AA}

\u{1F4C8} ${guideLinkText}`;
};

export const newsDigestStaleText = (lang: Lang): string => NEWS_DIGEST_STALE_TEXT_BY_LANG[lang];

export const getNewsDigestBatchState = (index: number, total: number): NewsDigestBatchState => {
  const safeTotal = Math.max(1, total);
  const safeIndex = Math.max(0, Math.min(safeTotal - 1, index));
  const batchStart = Math.floor(safeIndex / NEWS_DIGEST_BATCH_SIZE) * NEWS_DIGEST_BATCH_SIZE;
  const batchSize = Math.min(NEWS_DIGEST_BATCH_SIZE, safeTotal - batchStart);

  return {
    safeTotal,
    safeIndex,
    batchStart,
    batchSize,
    batchPosition: safeIndex - batchStart + 1,
    remainingAfterBatch: Math.max(0, safeTotal - (batchStart + batchSize)),
  };
};

export const isNewsDigestNavItem = (value: unknown): value is NewsDigestNavItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.wordId === 'number' &&
    typeof item.wordEn === 'string' &&
    typeof item.highlightedText === 'string' &&
    (item.translation === null || typeof item.translation === 'string') &&
    (item.sourceUrl === null || typeof item.sourceUrl === 'string') &&
    (item.sourceTitle === undefined || item.sourceTitle === null || typeof item.sourceTitle === 'string')
  );
};

export const newsDigestInlineKeyboard = (lang: Lang, index: number, total: number) => {
  const { safeIndex, safeTotal, batchPosition, batchSize, remainingAfterBatch } = getNewsDigestBatchState(index, total);
  const batchCounterText = newsDigestBatchCounterText(batchPosition, batchSize);
  const overallCounterText = newsDigestOverallCounterText(safeIndex, safeTotal);
  const hasPrev = safeIndex > 0;
  const hasNextInBatch = batchPosition < batchSize;
  const hasMore = !hasNextInBatch && remainingAfterBatch > 0;
  const rows = [];

  const navRow = [];
  if (safeTotal > 1) {
    navRow.push(Markup.button.callback(
      NEWS_NAV_PREV_LABEL_BY_LANG[lang],
      hasPrev ? NEWS_NAV_PREV_CALLBACK : NEWS_NAV_NOOP_CALLBACK,
    ));
  }
  if (hasMore) {
    navRow.push(Markup.button.callback(
      newsNavMoreLabel(lang, Math.min(NEWS_DIGEST_BATCH_SIZE, remainingAfterBatch), overallCounterText),
      NEWS_NAV_MORE_CALLBACK,
    ));
  } else {
    navRow.push(Markup.button.callback(batchCounterText, NEWS_NAV_NOOP_CALLBACK));
  }
  if (hasNextInBatch) {
    navRow.push(Markup.button.callback(NEWS_NAV_NEXT_LABEL_BY_LANG[lang], NEWS_NAV_NEXT_CALLBACK));
  }
  rows.push(navRow);

  return Markup.inlineKeyboard(rows);
};

export const renderNewsDigestCard = (lang: Lang, item: NewsDigestNavItem): string => {
  const translationPart = item.translation?.trim() ? ` - ${escapeHtml(item.translation.trim())}` : '';
  const sourceLine = item.sourceUrl
    ? `\n\n\u{1F517} <a href="${escapeHtml(item.sourceUrl)}">${escapeHtml(NEWS_READ_FULL_LABEL_BY_LANG[lang])}</a>`
    : (item.sourceTitle?.trim()
      ? `\n\n\u{1F50E} ${escapeHtml(NEWS_SOURCE_LABEL_BY_LANG[lang])}: ${escapeHtml(item.sourceTitle.trim())}`
      : '');

  return `<b>${NEWS_DIGEST_CARD_TITLE_BY_LANG[lang]}</b>\n\n\u{1F4A1} <b>${escapeHtml(item.wordEn)}</b>${translationPart}\n\n${item.highlightedText}${sourceLine}`;
};
