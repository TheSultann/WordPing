import { describe, expect, it } from 'vitest';
import {
  NEWS_DIGEST_BUTTONS,
  isNewsDigestNavItem,
  newsDigestInlineKeyboard,
  renderNewsDigestCard,
} from '../src/bot/newsDigestUi';

describe('news digest ui', () => {
  it('keeps digest buttons and callback layout stable', () => {
    expect(NEWS_DIGEST_BUTTONS).toEqual([
      '\u{1F4F0} \u041F\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043D\u043E\u0432\u043E\u0441\u0442\u0438',
      '\u{1F4F0} Yangiliklarni o\u2018qish',
    ]);

    const keyboard = newsDigestInlineKeyboard('ru', 0, 10);
    expect(keyboard.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data))).toEqual([
      ['newsnav:prev', 'newsnav:noop', 'newsnav:next'],
      ['newsnav:more'],
    ]);
  });

  it('renders escaped source link and validates nav items', () => {
    expect(isNewsDigestNavItem({ wordId: 1, wordEn: 'economy', highlightedText: 'text', translation: null, sourceUrl: null })).toBe(true);
    expect(isNewsDigestNavItem({ wordId: '1' })).toBe(false);

    const text = renderNewsDigestCard('ru', {
      wordId: 1,
      wordEn: '<economy>',
      translation: ' экономика ',
      highlightedText: '<u><b>ECONOMY</b></u> grows.',
      sourceUrl: 'https://news.example?q=1&x=2',
      sourceTitle: 'ignored',
    });

    expect(text).toContain('<b>\u{1F4F0} \u041D\u043E\u0432\u043E\u0441\u0442\u044C \u0434\u043D\u044F</b>');
    expect(text).toContain('\u{1F4A1} <b>&lt;economy&gt;</b> - экономика');
    expect(text).toContain('<u><b>ECONOMY</b></u> grows.');
    expect(text).toContain('<a href="https://news.example?q=1&amp;x=2">\u0427\u0438\u0442\u0430\u0442\u044C \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B</a>');
  });
});
