import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockFetchResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

const originalWindow = (globalThis as any).window;

const createFetchResponse = (response: MockFetchResponse) =>
  ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  } as Response);

const setWebWindow = (search: string, initData = '') => {
  (globalThis as any).window = {
    location: { search },
    Telegram: {
      WebApp: {
        initData,
      },
    },
  };
};

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  (globalThis as any).window = originalWindow;
});

describe('web api client', () => {
  it('uses x-dev-user-id header when initData is absent', async () => {
    setWebWindow('?devUserId=777');

    const fetchSpy = vi.fn().mockResolvedValue(
      createFetchResponse({
        ok: true,
        status: 200,
        body: {
          notificationsEnabled: true,
          notificationIntervalMinutes: 30,
          maxNotificationsPerDay: 20,
          quietHoursStartMinutes: 480,
          quietHoursEndMinutes: 1380,
        },
      })
    );
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const { api } = await import('../web/src/api');
    await api.getSettings();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(url).toBe('/api/settings');
    expect(headers['x-dev-user-id']).toBe('777');
    expect(headers['x-telegram-init-data']).toBeUndefined();
  });

  it('uses x-telegram-init-data header when available', async () => {
    setWebWindow('?devUserId=777', 'signed-init-data');

    const fetchSpy = vi.fn().mockResolvedValue(
      createFetchResponse({
        ok: true,
        status: 200,
        body: { streakCount: 0, words: 0, doneTodayCount: 0, dailyLimit: 20, dueToday: 0, learnedCount: 0 },
      })
    );
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const { api } = await import('../web/src/api');
    await api.getStats();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['x-telegram-init-data']).toBe('signed-init-data');
    expect(headers['x-dev-user-id']).toBeUndefined();
  });

  it('encodes query in getWords and throws API error text', async () => {
    setWebWindow('?devUserId=999');

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          ok: true,
          status: 200,
          body: { items: [] },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          ok: false,
          status: 403,
          body: { error: 'forbidden' },
        })
      );
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const { api } = await import('../web/src/api');
    await api.getWords('hello world?');

    const [firstUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toBe('/api/words?q=hello%20world%3F');

    await expect(api.getAdminOverview()).rejects.toThrow('forbidden');
  });

  it('sends correct method and payload for mutating API calls', async () => {
    setWebWindow('?devUserId=444');

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          ok: true,
          status: 200,
          body: { id: '444', language: 'uz' },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          ok: true,
          status: 200,
          body: {
            notificationsEnabled: false,
            notificationIntervalMinutes: 30,
            maxNotificationsPerDay: 20,
            quietHoursStartMinutes: 480,
            quietHoursEndMinutes: 1380,
          },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          ok: true,
          status: 200,
          body: { ok: true },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          ok: true,
          status: 200,
          body: { ok: true, total: 2, sent: 2, failed: 0 },
        })
      );
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const { api } = await import('../web/src/api');
    await api.updateMe({ language: 'uz' });
    await api.updateSettings({ notificationsEnabled: false });
    await api.deleteWord(42);
    await api.sendAdminBroadcast({ message: 'hello', photoUrl: 'https://example.test/p.jpg' });

    const [, updateMeInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(updateMeInit.method).toBe('PATCH');
    expect(String(updateMeInit.body)).toBe(JSON.stringify({ language: 'uz' }));

    const [, updateSettingsInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(updateSettingsInit.method).toBe('PATCH');
    expect(String(updateSettingsInit.body)).toBe(JSON.stringify({ notificationsEnabled: false }));

    const [deleteUrl, deleteInit] = fetchSpy.mock.calls[2] as [string, RequestInit];
    expect(deleteUrl).toBe('/api/words/42');
    expect(deleteInit.method).toBe('DELETE');

    const [broadcastUrl, broadcastInit] = fetchSpy.mock.calls[3] as [string, RequestInit];
    expect(broadcastUrl).toBe('/api/admin/broadcast');
    expect(broadcastInit.method).toBe('POST');
    expect(String(broadcastInit.body)).toBe(JSON.stringify({ message: 'hello', photoUrl: 'https://example.test/p.jpg' }));
  });

  it('keeps HTTP status text when error body is not JSON', async () => {
    setWebWindow('?devUserId=555');

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('invalid_json');
      },
    } as Response);
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const { api } = await import('../web/src/api');
    await expect(api.getMe()).rejects.toThrow('HTTP 500');
  });
});
