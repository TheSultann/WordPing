const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export type Settings = {
  notificationsEnabled: boolean;
  notificationIntervalMinutes: number;
  maxNotificationsPerDay: number;
  quietHoursStartMinutes: number;
  quietHoursEndMinutes: number;
};

export type Stats = {
  streakCount: number;
  words: number;
  doneTodayCount: number;
  dailyLimit: number;
  dueToday: number;
  learnedCount: number;
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
};

export type WordItem = {
  id: number;
  wordEn: string;
  translationRu: string;
  createdAt: string;
};

export type AdminUserSummary = {
  id: string;
  createdAt: string;
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

type ApiError = {
  error: string;
};

const getTelegramInitData = () =>
  (window as any)?.Telegram?.WebApp?.initData ?? '';

const getDevUserId = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get('devUserId') ?? import.meta.env.VITE_DEV_USER_ID ?? '';
};

const buildHeaders = () => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
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
  getWords: (q?: string) => {
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    return apiFetch<{ items: WordItem[] }>(`/words${query}`);
  },
  deleteWord: (id: number) =>
    apiFetch<{ ok: boolean }>(`/words/${id}`, { method: 'DELETE' }),
  getAdminOverview: () => apiFetch<AdminOverview>('/admin/overview'),
  getAdminUser: (id: string | number) => apiFetch<AdminUserSummary>(`/admin/users/${id}`),
  sendAdminBroadcast: (payload: { message: string; photoUrl?: string }) =>
    apiFetch<{ ok: boolean; total: number; sent: number; failed: number }>('/admin/broadcast', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

