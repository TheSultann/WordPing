import { describe, expect, it } from 'vitest';
import {
  isNewsDigestCallbackData,
  NEWS_NAV_MORE_CALLBACK,
  NEWS_NAV_NEXT_CALLBACK,
  NEWS_NAV_NOOP_CALLBACK,
  NEWS_NAV_PREV_CALLBACK,
  parseNewsDigestCallbackData,
} from '../src/bot/newsDigestCallbackData';

describe('news digest callback data', () => {
  it('keeps callback values stable', () => {
    expect(NEWS_NAV_PREV_CALLBACK).toBe('newsnav:prev');
    expect(NEWS_NAV_NEXT_CALLBACK).toBe('newsnav:next');
    expect(NEWS_NAV_NOOP_CALLBACK).toBe('newsnav:noop');
    expect(NEWS_NAV_MORE_CALLBACK).toBe('newsnav:more');
  });

  it('parses supported callback actions', () => {
    expect(parseNewsDigestCallbackData(NEWS_NAV_PREV_CALLBACK)).toBe('prev');
    expect(parseNewsDigestCallbackData(NEWS_NAV_NEXT_CALLBACK)).toBe('next');
    expect(parseNewsDigestCallbackData(NEWS_NAV_NOOP_CALLBACK)).toBe('noop');
    expect(parseNewsDigestCallbackData(NEWS_NAV_MORE_CALLBACK)).toBe('more');
  });

  it('rejects unsupported callback data', () => {
    expect(isNewsDigestCallbackData(NEWS_NAV_NEXT_CALLBACK)).toBe(true);
    expect(isNewsDigestCallbackData('newsnav:weird')).toBe(false);
    expect(parseNewsDigestCallbackData('newsnav:weird')).toBeNull();
    expect(parseNewsDigestCallbackData('quiz:next:1')).toBeNull();
  });
});
