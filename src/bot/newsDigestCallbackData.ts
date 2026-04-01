export type NewsDigestNavAction = 'prev' | 'next' | 'noop' | 'more';

export const NEWS_NAV_PREV_CALLBACK = 'newsnav:prev';
export const NEWS_NAV_NEXT_CALLBACK = 'newsnav:next';
export const NEWS_NAV_NOOP_CALLBACK = 'newsnav:noop';
export const NEWS_NAV_MORE_CALLBACK = 'newsnav:more';

export const isNewsDigestCallbackData = (data: string): boolean =>
  data === NEWS_NAV_PREV_CALLBACK ||
  data === NEWS_NAV_NEXT_CALLBACK ||
  data === NEWS_NAV_NOOP_CALLBACK ||
  data === NEWS_NAV_MORE_CALLBACK;

export const parseNewsDigestCallbackData = (data: string): NewsDigestNavAction | null => {
  switch (data) {
    case NEWS_NAV_PREV_CALLBACK:
      return 'prev';
    case NEWS_NAV_NEXT_CALLBACK:
      return 'next';
    case NEWS_NAV_NOOP_CALLBACK:
      return 'noop';
    case NEWS_NAV_MORE_CALLBACK:
      return 'more';
    default:
      return null;
  }
};
