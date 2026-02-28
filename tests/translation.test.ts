import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockHttpResponse = {
  status: number;
  body: unknown;
};

const envBackup = { ...process.env };

const asResponse = (res: MockHttpResponse): Response =>
  ({
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
  } as unknown as Response);

const installFetchMock = (
  handler: (url: string, init?: RequestInit) => MockHttpResponse,
) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    return asResponse(handler(url, init));
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
};

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  process.env = { ...envBackup };
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...envBackup };
});

describe('translation service', () => {
  it('detects Uzbek latin words more reliably', async () => {
    const { detectLanguage, detectLanguageWithMeta } = await import('../src/services/translation');

    expect(detectLanguage('jamoa')).toBe('uz');
    expect(detectLanguage('rahmat')).toBe('uz');
    expect(detectLanguage('yugurish')).toBe('uz');
    expect(detectLanguage('sotib olish')).toBe('uz');
    expect(detectLanguage("o'quvchi")).toBe('uz');
    expect(detectLanguage('apple')).toBe('en');
    expect(detectLanguage('young')).toBe('en');
    expect(detectLanguage('finish')).toBe('en');
    expect(detectLanguage('change', { preferredNative: 'uz' })).toBe('en');
    expect(detectLanguage('shopping', { preferredNative: 'uz' })).toBe('en');
    expect(detectLanguage('english', { preferredNative: 'uz' })).toBe('en');
    expect(detectLanguage('ham', { preferredNative: 'ru' })).toBe('en');
    expect(detectLanguage('ham', { preferredNative: 'uz' })).toBe('uz');
    expect(detectLanguageWithMeta('ham', { preferredNative: 'ru' })).toEqual({
      lang: 'en',
      ambiguous: true,
    });
  });

  it('marks obvious garbage auto-translations as suspicious', async () => {
    const { isSuspiciousAutoTranslation } = await import('../src/services/translation');

    expect(isSuspiciousAutoTranslation('hello', 'hello')).toBe(true);
    expect(isSuspiciousAutoTranslation('salom', 'c/dictation')).toBe(true);
    expect(isSuspiciousAutoTranslation('hello', 'привет')).toBe(false);
  });

  it('returns null for empty input and for same source/target language', async () => {
    process.env.HF_API_KEY = '';
    process.env.GEMINI_API_KEY = '';

    const fetchMock = installFetchMock(() => ({ status: 500, body: { error: 'should not be called' } }));

    const { translateAuto } = await import('../src/services/translation');
    const empty = await translateAuto('   ', 'ru');
    const sameLang = await translateAuto('привет', 'ru');

    expect(empty).toBeNull();
    expect(sameLang).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses Gemini fallback model when primary model fails', async () => {
    process.env.HF_API_KEY = 'hf-token';
    process.env.HF_INFERENCE_BASE_URL = 'https://hf.test/models';
    process.env.GEMINI_API_KEY = 'gm-key';
    process.env.GEMINI_API_BASE_URL = 'https://gem.test/models';
    process.env.GEMINI_MODEL = 'gem-primary';
    process.env.GEMINI_FALLBACK_MODELS = 'gem-secondary';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const fetchMock = installFetchMock((url) => {
      if (url.includes('https://hf.test/models/Helsinki-NLP/opus-mt-en-ru')) {
        return { status: 500, body: { error: 'hf unavailable' } };
      }
      if (url.includes('https://gem.test/models/gem-primary:generateContent')) {
        return { status: 429, body: { error: { message: 'quota exceeded' } } };
      }
      if (url.includes('https://gem.test/models/gem-secondary:generateContent')) {
        return {
          status: 200,
          body: {
            candidates: [{ content: { parts: [{ text: '\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b' }] } }],
          },
        };
      }
      if (url.includes('https://mymemory.test/get')) {
        return {
          status: 200,
          body: { responseData: { translatedText: '\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b' } },
        };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { suggestTranslation } = await import('../src/services/translation');
    const translated = await suggestTranslation('tools');

    expect(translated).toBe('\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b');
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('distributes Gemini requests using round robin order', async () => {
    process.env.HF_API_KEY = '';
    process.env.GEMINI_API_KEY = 'gm-key';
    process.env.GEMINI_API_BASE_URL = 'https://gem.test/models';
    process.env.GEMINI_MODEL = 'gem-a';
    process.env.GEMINI_FALLBACK_MODELS = 'gem-b,gem-c';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const seenModels: string[] = [];
    const fetchMock = installFetchMock((url) => {
      const match = url.match(/https:\/\/gem\.test\/models\/([^:]+):generateContent/);
      if (match) {
        seenModels.push(match[1] ?? '');
        return {
          status: 200,
          body: { candidates: [{ content: { parts: [{ text: '\u043f\u0435\u0440\u0435\u0432\u043e\u0434' }] } }] },
        };
      }
      if (url.includes('https://mymemory.test/get')) {
        return { status: 200, body: { responseData: { translatedText: '\u043f\u0435\u0440\u0435\u0432\u043e\u0434' } } };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { suggestTranslation } = await import('../src/services/translation');
    await suggestTranslation('alpha');
    await suggestTranslation('beta');
    await suggestTranslation('gamma');

    expect(seenModels).toEqual(['gem-a', 'gem-b', 'gem-c']);
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it('skips rate-limited Gemini model during cooldown window', async () => {
    process.env.HF_API_KEY = '';
    process.env.GEMINI_API_KEY = 'gm-key';
    process.env.GEMINI_API_BASE_URL = 'https://gem.test/models';
    process.env.GEMINI_MODEL = 'gem-a';
    process.env.GEMINI_FALLBACK_MODELS = 'gem-b';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const seenModels: string[] = [];
    const fetchMock = installFetchMock((url) => {
      const match = url.match(/https:\/\/gem\.test\/models\/([^:]+):generateContent/);
      if (match) {
        const model = match[1] ?? '';
        seenModels.push(model);
        if (model === 'gem-a') {
          return { status: 429, body: { error: { message: 'rate limited' } } };
        }
        return {
          status: 200,
          body: { candidates: [{ content: { parts: [{ text: '\u043f\u0435\u0440\u0435\u0432\u043e\u0434' }] } }] },
        };
      }
      if (url.includes('https://mymemory.test/get')) {
        return { status: 200, body: { responseData: { translatedText: '\u043f\u0435\u0440\u0435\u0432\u043e\u0434' } } };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { suggestTranslation } = await import('../src/services/translation');
    await suggestTranslation('first-word');
    await suggestTranslation('second-word');

    expect(seenModels).toEqual(['gem-a', 'gem-b', 'gem-b']);
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it('activates global Gemini pause only when all models are rate-limited', async () => {
    process.env.HF_API_KEY = '';
    process.env.GEMINI_API_KEY = 'gm-key';
    process.env.GEMINI_API_BASE_URL = 'https://gem.test/models';
    process.env.GEMINI_MODEL = 'gem-a';
    process.env.GEMINI_FALLBACK_MODELS = 'gem-b';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const seenModels: string[] = [];
    let myMemoryCalls = 0;

    installFetchMock((url) => {
      const match = url.match(/https:\/\/gem\.test\/models\/([^:]+):generateContent/);
      if (match) {
        seenModels.push(match[1] ?? '');
        return { status: 429, body: { error: { message: 'rate limited' } } };
      }
      if (url.includes('https://mymemory.test/get')) {
        myMemoryCalls += 1;
        return { status: 200, body: { responseData: { translatedText: '\u043f\u0435\u0440\u0435\u0432\u043e\u0434' } } };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { suggestTranslation } = await import('../src/services/translation');
    const first = await suggestTranslation('first');
    const second = await suggestTranslation('second');

    expect(first).toBe('\u043f\u0435\u0440\u0435\u0432\u043e\u0434');
    expect(second).toBe('\u043f\u0435\u0440\u0435\u0432\u043e\u0434');
    expect(seenModels).toEqual(['gem-a', 'gem-b']);
    expect(myMemoryCalls).toBe(2);
  });

  it('retries Hugging Face after 503 with estimated_time and parses object response', async () => {
    process.env.HF_API_KEY = 'hf-token';
    process.env.HF_INFERENCE_BASE_URL = 'https://hf.test/models';
    process.env.GEMINI_API_KEY = '';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const fetchMock = installFetchMock((url) => {
      if (url.includes('https://hf.test/models/Helsinki-NLP/opus-mt-ru-en')) {
        if (fetchMock.mock.calls.length === 1) {
          return { status: 503, body: { error: 'loading', estimated_time: 0.01 } };
        }
        return { status: 200, body: { translation_text: 'hello' } };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { translateAuto } = await import('../src/services/translation');
    const translated = await translateAuto('привет', 'en');

    expect(translated).toBe('hello');
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('falls back to MyMemory when HF response is invalid JSON and Gemini returns no candidates', async () => {
    process.env.HF_API_KEY = 'hf-token';
    process.env.HF_INFERENCE_BASE_URL = 'https://hf.test/models';
    process.env.GEMINI_API_KEY = 'gm-key';
    process.env.GEMINI_API_BASE_URL = 'https://gem.test/models';
    process.env.GEMINI_MODEL = 'gem-primary';
    process.env.GEMINI_FALLBACK_MODELS = 'gem-secondary,gem-secondary';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const fetchMock = installFetchMock((url) => {
      if (url.includes('https://hf.test/models/Helsinki-NLP/opus-mt-en-ru')) {
        return { status: 200, body: 'not-json-response' };
      }
      if (url.includes('https://gem.test/models/')) {
        return { status: 200, body: {} };
      }
      if (url.includes('https://mymemory.test/get')) {
        return {
          status: 200,
          body: { responseData: { translatedText: '\u043f\u0435\u0440\u0435\u0432\u043e\u0434' } },
        };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { suggestTranslation } = await import('../src/services/translation');
    const translated = await suggestTranslation('tools');

    expect(translated).toBe('\u043f\u0435\u0440\u0435\u0432\u043e\u0434');
    expect(fetchMock.mock.calls.length).toBe(4);
  });

  it('routes uz->ru via english', async () => {
    process.env.HF_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const seenUrls: string[] = [];
    const fetchMock = installFetchMock((url) => {
      seenUrls.push(url);
      if (url.includes('langpair=uz|en')) {
        return { status: 200, body: { responseData: { translatedText: 'hello' } } };
      }
      if (url.includes('langpair=en|ru')) {
        return { status: 200, body: { responseData: { translatedText: '\u043f\u0440\u0438\u0432\u0435\u0442' } } };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { translateAuto } = await import('../src/services/translation');
    const translated = await translateAuto('salom', 'ru');

    expect(translated).toBe('\u043f\u0440\u0438\u0432\u0435\u0442');
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(seenUrls[0]).toContain('langpair=uz|en');
    expect(seenUrls[1]).toContain('langpair=en|ru');
  });

  it('routes ru->uz via english', async () => {
    process.env.HF_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const seenUrls: string[] = [];
    const fetchMock = installFetchMock((url) => {
      seenUrls.push(url);
      if (url.includes('langpair=ru|en')) {
        return { status: 200, body: { responseData: { translatedText: 'hello' } } };
      }
      if (url.includes('langpair=en|uz')) {
        return { status: 200, body: { responseData: { translatedText: 'salom' } } };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { translateAuto } = await import('../src/services/translation');
    const translated = await translateAuto('привет', 'uz');

    expect(translated).toBe('salom');
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(seenUrls[0]).toContain('langpair=ru|en');
    expect(seenUrls[1]).toContain('langpair=en|uz');
  });

  it('falls back when upstream fetch throws network errors', async () => {
    process.env.HF_API_KEY = 'hf-token';
    process.env.HF_INFERENCE_BASE_URL = 'https://hf.test/models';
    process.env.GEMINI_API_KEY = 'gm-key';
    process.env.GEMINI_API_BASE_URL = 'https://gem.test/models';
    process.env.GEMINI_MODEL = 'gem-primary';
    process.env.GEMINI_FALLBACK_MODELS = 'gem-secondary';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url.includes('https://mymemory.test/get')) {
        return asResponse({
          status: 200,
          body: { responseData: { translatedText: '\u043f\u0435\u0440\u0435\u0432\u043e\u0434' } },
        });
      }

      throw new Error('network_down');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { suggestTranslation } = await import('../src/services/translation');
    const translated = await suggestTranslation('tools');

    expect(translated).toBe('\u043f\u0435\u0440\u0435\u0432\u043e\u0434');
    expect(fetchMock.mock.calls.length).toBe(4);
  });

  it('uses in-memory cache for repeated translations', async () => {
    process.env.HF_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const fetchMock = installFetchMock((url) => {
      if (url.includes('https://mymemory.test/get')) {
        return {
          status: 200,
          body: { responseData: { translatedText: '\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b' } },
        };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { suggestTranslation } = await import('../src/services/translation');
    const first = await suggestTranslation('tools');
    const second = await suggestTranslation('tools');

    expect(first).toBe('\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b');
    expect(second).toBe('\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b');
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it('evicts oldest translations when cache exceeds configured limit', async () => {
    process.env.HF_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';
    process.env.TRANSLATE_CACHE_MAX = '100';

    const fetchMock = installFetchMock((url) => {
      if (url.includes('https://mymemory.test/get')) {
        const parsed = new URL(url);
        const q = parsed.searchParams.get('q') ?? '';
        return { status: 200, body: { responseData: { translatedText: `tr-${q}` } } };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { suggestTranslation } = await import('../src/services/translation');
    for (let i = 1; i <= 101; i += 1) {
      await suggestTranslation(`word-${i}`);
    }

    await suggestTranslation('word-1');
    expect(fetchMock.mock.calls.length).toBe(102);
  });

  it('refines uz translation when first result is loanword copy of english word', async () => {
    process.env.HF_API_KEY = '';
    process.env.GEMINI_API_KEY = 'gm-key';
    process.env.GEMINI_API_BASE_URL = 'https://gem.test/models';
    process.env.GEMINI_MODEL = 'gem-primary';
    process.env.GEMINI_FALLBACK_MODELS = '';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const fetchMock = installFetchMock((url) => {
      if (url.includes('https://gem.test/models/gem-primary:generateContent')) {
        if (fetchMock.mock.calls.length === 1) {
          return {
            status: 200,
            body: {
              candidates: [{ content: { parts: [{ text: 'konsensus' }] } }],
            },
          };
        }
        return {
          status: 200,
          body: {
            candidates: [{ content: { parts: [{ text: 'kelishuv' }] } }],
          },
        };
      }
      if (url.includes('https://mymemory.test/get')) {
        return { status: 200, body: { responseData: { translatedText: 'konsensus' } } };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { suggestTranslation } = await import('../src/services/translation');
    const translated = await suggestTranslation('consensus', 'uz');

    expect(translated).toBe('kelishuv');
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('refines ru translation when first result is transliterated loanword', async () => {
    process.env.HF_API_KEY = '';
    process.env.GEMINI_API_KEY = 'gm-key';
    process.env.GEMINI_API_BASE_URL = 'https://gem.test/models';
    process.env.GEMINI_MODEL = 'gem-primary';
    process.env.GEMINI_FALLBACK_MODELS = '';
    process.env.TRANSLATE_API_URL = 'https://mymemory.test/get';

    const fetchMock = installFetchMock((url) => {
      if (url.includes('https://gem.test/models/gem-primary:generateContent')) {
        if (fetchMock.mock.calls.length === 1) {
          return {
            status: 200,
            body: {
              candidates: [{ content: { parts: [{ text: 'консенсус' }] } }],
            },
          };
        }
        return {
          status: 200,
          body: {
            candidates: [{ content: { parts: [{ text: 'согласие' }] } }],
          },
        };
      }
      if (url.includes('https://mymemory.test/get')) {
        return { status: 200, body: { responseData: { translatedText: 'консенсус' } } };
      }
      return { status: 500, body: { error: 'unexpected url' } };
    });

    const { suggestTranslation } = await import('../src/services/translation');
    const translated = await suggestTranslation('consensus', 'ru');

    expect(translated).toBe('согласие');
    expect(fetchMock.mock.calls.length).toBe(2);
  });
});
