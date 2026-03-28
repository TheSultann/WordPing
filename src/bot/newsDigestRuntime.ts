import type { Context, Markup } from 'telegraf';
import type { Prisma} from '../generated/prisma/client';
import { type UserSession } from '../generated/prisma/client';
import { prisma } from '../db/client';
import type { Lang } from '../i18n';
import { buildUserNewsDigest, type NewsDigestItem } from '../services/newsFallbackService';
import { ensureSession } from '../services/sessionService';
import { createLogger } from '../utils/logger';
import { parseNewsDigestCallbackData, type NewsDigestNavAction } from './newsDigestCallbackData';
import {
  NEWS_DIGEST_BATCH_SIZE,
  isNewsDigestNavItem,
  newsDigestFallbackText,
  newsDigestInlineKeyboard,
  newsDigestStaleText,
  renderNewsDigestCard,
  type NewsDigestNavItem,
} from './newsDigestUi';

type MainReplyKeyboardFactory = (lang: Lang) => ReturnType<typeof Markup.keyboard>;

type NewsDigestRuntimeOptions = {
  mainReplyKeyboard: MainReplyKeyboardFactory;
  buildGuideLinkText: (lang: Lang) => string;
};

type NewsDigestSessionSnapshot = Pick<UserSession, 'payload'>;
type NewsDigestMoveAction = Exclude<NewsDigestNavAction, 'noop'>;
const newsDigestLogger = createLogger('bot').child({ component: 'news-digest' });

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
};

const mapNewsDigestItems = (digest: NewsDigestItem[]): NewsDigestNavItem[] =>
  digest.map((item) => ({
    wordId: item.wordId,
    wordEn: item.wordEn,
    translation: item.translation,
    highlightedText: item.highlightedText,
    sourceUrl: item.sourceUrl,
    sourceTitle: item.sourceTitle,
  }));

const readNewsDigestSession = (session: NewsDigestSessionSnapshot) => {
  const payloadBase = asRecord(session.payload) ?? {};
  const digestPayload = asRecord(payloadBase.newsDigest);
  const rawItems = Array.isArray(digestPayload?.items) ? digestPayload.items : [];
  const items = rawItems.filter(isNewsDigestNavItem);
  const currentIndex = typeof digestPayload?.index === 'number' && Number.isFinite(digestPayload.index)
    ? Math.max(0, Math.min(Math.max(items.length - 1, 0), digestPayload.index))
    : 0;

  return {
    payloadBase,
    items,
    currentIndex,
  };
};

const buildNewsDigestPayload = (payloadBase: Record<string, unknown>, items: NewsDigestNavItem[], index: number) => ({
  ...payloadBase,
  newsDigest: {
    items,
    index,
    updatedAt: new Date().toISOString(),
  },
});

export const getNextNewsDigestIndex = (
  action: NewsDigestMoveAction,
  currentIndex: number,
  total: number,
): number => {
  const safeTotal = Math.max(1, total);
  const safeIndex = Math.max(0, Math.min(safeTotal - 1, currentIndex));

  if (action === 'more') {
    return Math.min(
      safeTotal - 1,
      Math.floor(safeIndex / NEWS_DIGEST_BATCH_SIZE) * NEWS_DIGEST_BATCH_SIZE + NEWS_DIGEST_BATCH_SIZE,
    );
  }

  const step = action === 'next' ? 1 : -1;
  return (safeIndex + step + safeTotal) % safeTotal;
};

export const createNewsDigestRuntime = ({ mainReplyKeyboard, buildGuideLinkText }: NewsDigestRuntimeOptions) => {
  const handleNewsDigestStart = async (ctx: Context, userId: bigint, lang: Lang) => {
    try {
      const digest = await buildUserNewsDigest(userId);

      if (!digest.length) {
        await ctx.reply(newsDigestFallbackText(lang, buildGuideLinkText(lang)), {
          parse_mode: 'HTML',
          ...mainReplyKeyboard(lang),
        });
        return;
      }

      const session = await ensureSession(userId);
      const payloadBase = asRecord(session.payload) ?? {};
      const digestItems = mapNewsDigestItems(digest);

      await prisma.userSession.update({
        where: { userId },
        data: {
          payload: buildNewsDigestPayload(payloadBase, digestItems, 0) as Prisma.InputJsonValue,
        },
      });

      await ctx.reply(renderNewsDigestCard(lang, digestItems[0]!), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...newsDigestInlineKeyboard(lang, 0, digestItems.length),
      });
    } catch (error) {
      newsDigestLogger.error('news digest failed', { userId: userId.toString(), error });
      await ctx.reply(newsDigestFallbackText(lang, buildGuideLinkText(lang)), {
        parse_mode: 'HTML',
        ...mainReplyKeyboard(lang),
      });
    }
  };

  const handleNewsDigestCallback = async (
    ctx: Context,
    userId: bigint,
    lang: Lang,
    data: string,
    session: NewsDigestSessionSnapshot,
  ) => {
    const action = parseNewsDigestCallbackData(data);
    if (!action) return;

    const { payloadBase, items, currentIndex } = readNewsDigestSession(session);
    if (!items.length) {
      await ctx.answerCbQuery(newsDigestStaleText(lang));
      return;
    }

    if (action === 'noop') {
      await ctx.answerCbQuery(`${currentIndex + 1}/${items.length}`);
      return;
    }

    const nextIndex = getNextNewsDigestIndex(action, currentIndex, items.length);

    await prisma.userSession.update({
      where: { userId },
      data: {
        payload: buildNewsDigestPayload(payloadBase, items, nextIndex) as Prisma.InputJsonValue,
      },
    });

    await ctx.editMessageText(renderNewsDigestCard(lang, items[nextIndex]!), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...newsDigestInlineKeyboard(lang, nextIndex, items.length),
    });
    await ctx.answerCbQuery(`${nextIndex + 1}/${items.length}`);
  };

  return {
    handleNewsDigestStart,
    handleNewsDigestCallback,
  };
};
