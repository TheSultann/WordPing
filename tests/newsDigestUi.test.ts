import { describe, expect, it } from 'vitest';
import {
  NEWS_DIGEST_BUTTONS,
  getNewsDigestBatchState,
  isNewsDigestNavItem,
  newsDigestInlineKeyboard,
  renderNewsDigestCard,
} from '../src/bot/newsDigestUi';

describe('news digest ui', () => {
  it('keeps digest buttons and batch keyboard layout stable', () => {
    expect(NEWS_DIGEST_BUTTONS).toEqual([
      '\u{1F4F0} \u041F\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043D\u043E\u0432\u043E\u0441\u0442\u0438',
      '\u{1F4F0} Yangiliklarni o\u2018qish',
    ]);

    const firstCardKeyboard = newsDigestInlineKeyboard('ru', 0, 10);
    expect(firstCardKeyboard.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data))).toEqual([
      ['newsnav:noop', 'newsnav:noop', 'newsnav:next'],
    ]);
    expect(firstCardKeyboard.reply_markup.inline_keyboard[0]?.[0]?.text).toBe('⬅️');
    expect(firstCardKeyboard.reply_markup.inline_keyboard[0]?.[1]?.text).toBe('1/5');
    expect(firstCardKeyboard.reply_markup.inline_keyboard[0]?.[2]?.text).toBe('➡️');

    const fifthCardKeyboard = newsDigestInlineKeyboard('ru', 4, 10);
    expect(fifthCardKeyboard.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data))).toEqual([
      ['newsnav:prev', 'newsnav:more'],
    ]);
    expect(fifthCardKeyboard.reply_markup.inline_keyboard[0]?.[0]?.text).toBe('⬅️');
    expect(fifthCardKeyboard.reply_markup.inline_keyboard[0]?.[1]?.text).toBe('\u{1F4DA} \u0415\u0449\u0451 5 \u2022 5/10');

    const sixthCardKeyboard = newsDigestInlineKeyboard('ru', 5, 10);
    expect(sixthCardKeyboard.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data))).toEqual([
      ['newsnav:prev', 'newsnav:noop', 'newsnav:next'],
    ]);
    expect(sixthCardKeyboard.reply_markup.inline_keyboard[0]?.[1]?.text).toBe('1/5');
  });

  it('computes batch-local position and size', () => {
    expect(getNewsDigestBatchState(0, 10)).toMatchObject({
      batchStart: 0,
      batchSize: 5,
      batchPosition: 1,
      remainingAfterBatch: 5,
    });

    expect(getNewsDigestBatchState(5, 10)).toMatchObject({
      batchStart: 5,
      batchSize: 5,
      batchPosition: 1,
      remainingAfterBatch: 0,
    });

    expect(getNewsDigestBatchState(5, 7)).toMatchObject({
      batchStart: 5,
      batchSize: 2,
      batchPosition: 1,
      remainingAfterBatch: 0,
    });
  });

  it('renders escaped source link and validates nav items', () => {
    expect(isNewsDigestNavItem({ wordId: 1, wordEn: 'economy', highlightedText: 'text', translation: null, sourceUrl: null })).toBe(true);
    expect(isNewsDigestNavItem({ wordId: '1' })).toBe(false);

    const text = renderNewsDigestCard('ru', {
      wordId: 1,
      wordEn: '<economy>',
      translation: ' \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u043A\u0430 ',
      highlightedText: '<u><b>ECONOMY</b></u> grows.',
      sourceUrl: 'https://news.example?q=1&x=2',
      sourceTitle: 'ignored',
    });

    expect(text).toContain('<b>\u{1F4F0} \u041D\u043E\u0432\u043E\u0441\u0442\u044C \u0434\u043D\u044F</b>');
    expect(text).toContain('\u{1F4A1} <b>&lt;economy&gt;</b> - \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u043A\u0430');
    expect(text).toContain('<u><b>ECONOMY</b></u> grows.');
    expect(text).toContain('<a href="https://news.example?q=1&amp;x=2">\u0427\u0438\u0442\u0430\u0442\u044C \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B</a>');
  });
});
