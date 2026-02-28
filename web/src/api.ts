const API_BASE = '/api';

export type Settings = {
  notificationsEnabled: boolean;
  notificationIntervalMinutes: number;
  maxNotificationsPerDay: number;
  quietHoursStartMinutes: number;
  quietHoursEndMinutes: number;
};

export type Stats = {
  streakCount: number;
  wordsTotal: number;
  learnedTotal: number;
  dueTodayCount: number;
  dueNowTotal: number;
  doneTodayCount: number;
  accuracyTodayPercent: number;
  notificationsSentToday: number;
  dailyLimit: number;
};

export type Me = {
  id: string;
  language: string;
  timezone: string | null;
  notificationsEnabled: boolean;
  notificationIntervalMinutes: number;
  maxNotificationsPerDay: number;
  quietHoursStartMinutes: number;
  quietHoursEndMinutes: number;
  streakCount: number;
  doneTodayCount: number;
  referralCount: number;
  isAdmin?: boolean;
};

export type WordItem = {
  id: number;
  wordEn: string;
  translationRu: string;
  createdAt: string;
  stage?: number | null;
  nextReviewAt?: string | null;
};

export type WordsResponse = {
  items: WordItem[];
  hasMore: boolean;
};

export type AdminUserSummary = {
  id: string;
  createdAt: string;
  displayName?: string | null;
  tgUsername?: string | null;
  tgFirstName?: string | null;
  tgLastName?: string | null;
  wordsCount: number;
  learnedCount: number;
  postponedCount: number;
};

export type AdminOverview = {
  totals: {
    users: number;
    words: number;
    notificationsSentToday: number;
  };
  activeToday: number;
  newLast7Days: number;
  recentUsers: AdminUserSummary[];
};

export type AdminUsersResponse = {
  items: AdminUserSummary[];
  hasMore: boolean;
};

type ApiError = {
  error: string;
};

const getTelegramInitData = () =>
  (window as any)?.Telegram?.WebApp?.initData ?? '';

const getDevUserId = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get('devUserId') ?? import.meta.env.VITE_DEV_USER_ID ?? '';
};

const getTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
};

const buildHeaders = () => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const timezone = getTimezone();
  if (timezone) headers['x-timezone'] = timezone;
  const initData = getTelegramInitData();
  if (initData) {
    headers['x-telegram-init-data'] = initData;
  } else {
    const devUserId = getDevUserId();
    if (devUserId) headers['x-dev-user-id'] = devUserId;
  }
  return headers;
};

const apiFetch = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...buildHeaders(),
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as ApiError;
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
};

export const api = {
  getMe: () => apiFetch<Me>('/me'),
  updateMe: (payload: Partial<Pick<Me, 'language'>>) =>
    apiFetch<Me>('/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getSettings: () => apiFetch<Settings>('/settings'),
  updateSettings: (payload: Partial<Settings>) =>
    apiFetch<Settings>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getStats: () => apiFetch<Stats>('/stats'),
  getWords: (q?: string, limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (q?.trim()) params.set('q', q.trim());
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
      params.set('limit', String(Math.min(Math.max(limit, 1), 200)));
    }
    if (typeof offset === 'number' && Number.isFinite(offset) && offset > 0) {
      params.set('offset', String(Math.max(offset, 0)));
    }
    const query = params.toString();
    return apiFetch<WordsResponse>(`/words${query ? `?${query}` : ''}`);
  },
  deleteWord: (id: number) =>
    apiFetch<{ ok: boolean }>(`/words/${id}`, { method: 'DELETE' }),
  getAdminOverview: () => apiFetch<AdminOverview>('/admin/overview'),
  getAdminUsers: (q?: string, limit = 20, offset = 0) => {
    const params = new URLSearchParams();
    if (q?.trim()) params.set('q', q.trim());
    if (Number.isFinite(limit) && limit > 0) params.set('limit', String(Math.min(Math.max(limit, 1), 100)));
    if (Number.isFinite(offset) && offset > 0) params.set('offset', String(Math.max(offset, 0)));
    const query = params.toString();
    return apiFetch<AdminUsersResponse>(`/admin/users${query ? `?${query}` : ''}`);
  },
  getAdminUser: (id: string | number) => apiFetch<AdminUserSummary>(`/admin/users/${id}`),
  sendAdminBroadcast: (payload: { message: string; photoUrl?: string }) =>
    apiFetch<{ ok: boolean; total: number; sent: number; failed: number }>('/admin/broadcast', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};


