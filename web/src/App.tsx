import { useEffect, useMemo, useRef, useState } from 'react';
import { api, Settings, Stats, WordItem, Me, AdminOverview, AdminUserSummary } from './api';
import {
  Settings as SettingsIcon,
  Book,
  BookOpen,
  House,
  Save,
  RotateCcw,
  Trash2,
  Flame,
  UserPlus,
  Languages,
  Zap,
  Clock,
  Bell,
  Target,
  Search,
  Shield,
  Users,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

const minutesToTime = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
};

const timeToMinutes = (value: string) => {
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return parseInt(match[1]!, 10) * 60 + parseInt(match[2]!, 10);
};

const getTelegramUser = () => (window as any)?.Telegram?.WebApp?.initDataUnsafe?.user;
const BOT_USERNAME = (import.meta as any).env?.VITE_BOT_USERNAME ?? '';
const ADMIN_ID = 467595754;

const COPY = {
  ru: {
    tagline: 'Учись умнее',
    noticeAuth: 'Открой Mini App внутри Telegram или добавь ?devUserId=123 для локальной проверки.',
    saved: 'Сохранено',
    loadSettingsError: 'Не удалось загрузить настройки',
    loadStatsError: 'Не удалось загрузить статистику',
    loadWordsError: 'Не удалось загрузить слова',
    saveSettingsError: 'Не удалось сохранить настройки',
    saveLanguageError: 'Не удалось сохранить язык',
    deleteConfirm: 'Удалить слово?',
    deleteError: 'Не удалось удалить слово',
    userFallback: 'Пользователь',
    streakSubtitle: 'дней подряд',
    streakTip: 'Начни сегодня — первая серия начинается тут',
    milestoneDays: 'дней',
    progress: 'Прогресс',
    doneToday: 'Сделано сегодня',
    dictionary: 'Словарь',
    dueToday: 'На повтор',
    learned: 'Изучил',
    statsLoading: 'Загрузка статистики...',
    wordsTitle: 'Словарь',
    wordsSearch: 'Поиск...',
    wordsEmpty: 'Слов пока нет',
    settingsTitle: 'Уведомления',
    settingsLoading: 'Загрузка...',
    notifyToggle: 'Включить уведомления',
    intervalLabel: 'Интервал (мин)',
    limitLabel: 'Лимит в день',
    quietHours: 'Тихие часы',
    quietStart: 'Начало',
    quietEnd: 'Конец',
    interfaceTitle: 'Интерфейс',
    languageLabel: 'Язык',
    languageRu: 'Русский',
    languageUz: "O'zbekcha",
    themeLabel: 'Тема',
    themeLight: 'Светлая',
    themeDark: 'Темная',
    inviteTitle: 'Пригласи друзей',
    inviteDesc: 'Твоя реферальная ссылка — за неё позже можно будет получать подписку.',
    inviteButton: 'Пригласить друзей',
    inviteCopy: 'Скопировать ссылку',
    inviteCopied: 'Ссылка скопирована',
    inviteCopyFailed: 'Не удалось скопировать ссылку',
    inviteMissingBot: 'Укажи VITE_BOT_USERNAME для ссылки на бота',
    inviteLinkLabel: 'Твоя ссылка:',
    inviteCountLabel: 'Приглашено',
    inviteShareText: 'Присоединяйся к WordPing — тренируй слова с умными напоминаниями.',
    save: 'Сохранить',
    adminLabel: 'Админ',
    userIdLabel: 'ID',
    tabHome: 'Главная',
    tabDictionary: 'Словарь',
    tabSettings: 'Настройки',
    tabAdmin: 'Админ',
    adminTitle: 'Админ-панель',
    adminOverview: 'Сводка',
    adminTotalUsers: 'Пользователи',
    adminActiveToday: 'Активные сегодня (UTC)',
    adminNew7Days: 'Новые за 7 дней',
    adminTotalWords: 'Слов всего',
    adminNotificationsToday: 'Уведомлений сегодня',
    adminLookupTitle: 'Поиск пользователя',
    adminLookupHint: 'Ищи по Telegram ID',
    adminSearchPlaceholder: 'Telegram ID',
    adminSearchAction: 'Найти',
    adminSearchClear: 'Очистить',
    adminLookupLoading: 'Загрузка пользователя...',
    adminLookupIdle: 'Введи Telegram ID и нажми «Найти».',
    adminNotFound: 'Пользователь не найден',
    adminRecentTitle: 'Последние регистрации',
    adminRecentEmpty: 'Пока нет регистраций',
    adminOverviewLoading: 'Загрузка обзора...',
    adminOverviewError: 'Не удалось загрузить обзор',
    adminLookupError: 'Не удалось загрузить пользователя',
    adminUserDetails: 'Карточка пользователя',
    adminFieldId: 'ID',
    adminFieldCreated: 'Создан',
    adminFieldWords: 'Слов',
    adminFieldLearned: 'Изучил',
    adminFieldPostponed: 'Отложил',
    adminCopyId: 'Скопировать ID',
    adminCopied: 'Скопировано',
    adminYes: 'Да',
    adminNo: 'Нет',
    adminBroadcastTitle: 'Сообщение всем',
    adminBroadcastPlaceholder: 'Текст для всех пользователей...',
    adminBroadcastPhotoLabel: 'Фото (URL)',
    adminBroadcastPhotoHint: 'Нужна публичная HTTPS-ссылка',
    adminBroadcastSend: 'Отправить всем',
    adminBroadcastSending: 'Рассылка...',
    adminBroadcastSent: 'Рассылка завершена',
    adminBroadcastError: 'Не удалось отправить всем',
    adminBroadcastConfirm: 'Отправить сообщение всем пользователям?',
    adminBroadcastConfirmCount: 'Отправить сообщение всем пользователям? Получателей: {count}.',
    adminBroadcastPreview: 'Предпросмотр',
    adminBroadcastPreviewEmpty: 'Текст сообщения появится здесь.',
  },
  uz: {
    tagline: "Aqlliroq o'rgan",
    noticeAuth: "Mini Appni Telegram ichida oching yoki lokal tekshiruv uchun ?devUserId=123 qoshing.",
    saved: 'Saqlangan',
    loadSettingsError: "Sozlamalarni yuklab bo'lmadi",
    loadStatsError: "Statistikani yuklab bo'lmadi",
    loadWordsError: "So'zlarni yuklab bo'lmadi",
    saveSettingsError: "Sozlamalarni saqlab bo'lmadi",
    saveLanguageError: "Tilni saqlab bo'lmadi",
    deleteConfirm: "So'zni ochirasizmi?",
    deleteError: "So'zni ochirib bo'lmadi",
    userFallback: 'Foydalanuvchi',
    streakSubtitle: 'kun ketma-ket',
    streakTip: 'Bugun boshlang — birinchi seriya shu yerda',
    milestoneDays: 'kun',
    progress: 'Progress',
    doneToday: 'Bugun bajarildi',
    dictionary: "Lug'at",
    dueToday: "Qayta ko'rish",
    learned: "O'rgangan",
    statsLoading: 'Statistika yuklanmoqda...',
    wordsTitle: "Lug'at",
    wordsSearch: 'Qidiruv...',
    wordsEmpty: "Hozircha so'zlar yo'q",
    settingsTitle: 'Bildirishnomalar',
    settingsLoading: 'Yuklanmoqda...',
    notifyToggle: 'Bildirishnomalarni yoqish',
    intervalLabel: 'Oraliq (daq)',
    limitLabel: 'Kunlik limit',
    quietHours: 'Tinch soatlar',
    quietStart: 'Boshlanish',
    quietEnd: 'Tugash',
    interfaceTitle: 'Interfeys',
    languageLabel: 'Til',
    languageRu: 'Ruscha',
    languageUz: "O'zbekcha",
    themeLabel: 'Mavzu',
    themeLight: "Yorug'",
    themeDark: "Qorong'i",
    inviteTitle: "Do'stlarni taklif qiling",
    inviteDesc: "Sizning referal havolangiz — keyinroq undan obuna olish mumkin bo'ladi.",
    inviteButton: "Do'stlarni taklif qilish",
    inviteCopy: 'Havolani nusxalash',
    inviteCopied: 'Havola nusxalandi',
    inviteCopyFailed: "Havolani nusxalash imkoni bo'lmadi",
    inviteMissingBot: 'Bot havolasi uchun VITE_BOT_USERNAME ni kiriting',
    inviteLinkLabel: 'Sizning havolangiz:',
    inviteCountLabel: "Taklif qilinganlar",
    inviteShareText: "WordPingga qo'shiling — so'zlarni aqlli eslatmalar bilan o'rganing.",
    save: 'Saqlash',
    adminLabel: 'Admin',
    userIdLabel: 'ID',
    tabHome: 'Asosiy',
    tabDictionary: "Lug'at",
    tabSettings: 'Sozlamalar',
    tabAdmin: 'Admin',
    adminTitle: 'Admin panel',
    adminOverview: 'Umumiy',
    adminTotalUsers: 'Foydalanuvchilar',
    adminActiveToday: 'Bugun faol (UTC)',
    adminNew7Days: '7 kunda yangi',
    adminTotalWords: "Jami so'zlar",
    adminNotificationsToday: 'Bugungi bildirishnomalar',
    adminLookupTitle: 'Foydalanuvchini qidirish',
    adminLookupHint: 'Telegram ID bo‘yicha',
    adminSearchPlaceholder: 'Telegram ID',
    adminSearchAction: 'Qidirish',
    adminSearchClear: 'Tozalash',
    adminLookupLoading: 'Foydalanuvchi yuklanmoqda...',
    adminLookupIdle: 'Telegram ID kiriting va «Qidirish» tugmasini bosing.',
    adminNotFound: 'Foydalanuvchi topilmadi',
    adminRecentTitle: "So‘nggi ro‘yxatdan o‘tganlar",
    adminRecentEmpty: "Hozircha ro‘yxatdan o‘tganlar yo‘q",
    adminOverviewLoading: "Umumiy ma'lumot yuklanmoqda...",
    adminOverviewError: "Umumiy ma'lumotni yuklab bo'lmadi",
    adminLookupError: 'Foydalanuvchini yuklab bo‘lmadi',
    adminUserDetails: 'Foydalanuvchi kartasi',
    adminFieldId: 'ID',
    adminFieldCreated: 'Yaratilgan',
    adminFieldWords: "So'zlar",
    adminFieldLearned: 'O‘rgangan',
    adminFieldPostponed: 'Kechiktirgan',
    adminCopyId: 'ID nusxa olish',
    adminCopied: 'Nusxalandi',
    adminYes: 'Ha',
    adminNo: "Yo'q",
    adminBroadcastTitle: 'Hammaga xabar',
    adminBroadcastPlaceholder: 'Barcha foydalanuvchilar uchun matn...',
    adminBroadcastPhotoLabel: 'Rasm (URL)',
    adminBroadcastPhotoHint: 'Ommaviy HTTPS havola kerak',
    adminBroadcastSend: 'Hammaga yuborish',
    adminBroadcastSending: 'Yuborilmoqda...',
    adminBroadcastSent: 'Yuborish tugadi',
    adminBroadcastError: 'Hammaga yuborib bo‘lmadi',
    adminBroadcastConfirm: 'Barcha foydalanuvchilarga yuborasizmi?',
    adminBroadcastConfirmCount: 'Barchaga yuborilsinmi? Qabul qiluvchilar soni: {count}.',
    adminBroadcastPreview: 'Oldindan ko‘rish',
    adminBroadcastPreviewEmpty: 'Xabar matni shu yerda ko‘rinadi.',
  },
} as const;

type Lang = keyof typeof COPY;
type CopyKey = keyof (typeof COPY)['ru'];
type WordStatus = 'learned' | 'due' | 'new';

const LANG_STORAGE_KEY = 'wordping.lang';
const DATA_CACHE_TTL_MS = 30_000;
const LEARNED_STAGE_MIN = 4;

const resolveWordStatus = (word: WordItem): WordStatus => {
  if (word.nextReviewAt) {
    const nextReviewAtMs = Date.parse(word.nextReviewAt);
    if (Number.isFinite(nextReviewAtMs) && nextReviewAtMs <= Date.now()) {
      return 'due';
    }
  }
  if ((word.stage ?? 0) >= LEARNED_STAGE_MIN) return 'learned';
  return 'new';
};

const getStoredLang = (): Lang | null => {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(LANG_STORAGE_KEY);
  return value === 'uz' || value === 'ru' ? value : null;
};

const App = () => {
  const [tab, setTab] = useState<'settings' | 'stats' | 'words' | 'admin'>('stats');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [words, setWords] = useState<WordItem[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lang, setLang] = useState<Lang>(() => getStoredLang() ?? 'ru');
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [adminOverviewLoading, setAdminOverviewLoading] = useState(false);
  const [adminOverviewError, setAdminOverviewError] = useState('');
  const [adminQuery, setAdminQuery] = useState('');
  const [adminUser, setAdminUser] = useState<AdminUserSummary | null>(null);
  const [adminLookupLoading, setAdminLookupLoading] = useState(false);
  const [adminLookupError, setAdminLookupError] = useState('');
  const [adminNotFound, setAdminNotFound] = useState(false);
  const [adminBroadcastMessage, setAdminBroadcastMessage] = useState('');
  const [adminBroadcastPhoto, setAdminBroadcastPhoto] = useState('');
  const [adminBroadcastLoading, setAdminBroadcastLoading] = useState(false);
  const [adminBroadcastNotice, setAdminBroadcastNotice] = useState('');
  const [adminBroadcastError, setAdminBroadcastError] = useState('');

  const telegramUser = useMemo(() => getTelegramUser(), []);
  const isTelegramWebApp = useMemo(() => Boolean((window as any)?.Telegram?.WebApp), []);
  const prefersReducedMotion = useMemo(
    () => (typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false : false),
    []
  );
  const useLiteUi = isTelegramWebApp || prefersReducedMotion;
  const hasInitData = Boolean((window as any)?.Telegram?.WebApp?.initData);
  const devUserId = new URLSearchParams(window.location.search).get('devUserId');
  const canAuth = hasInitData || Boolean(devUserId);
  const adminCandidateId = useMemo(() => {
    const candidates: Array<string | number | null | undefined> = [
      me?.id,
      telegramUser?.id,
      devUserId,
    ];
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === '') continue;
      const value = Number(candidate);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }, [me?.id, telegramUser?.id, devUserId]);
  const isAdmin = adminCandidateId === ADMIN_ID;

  const t = (key: CopyKey, params?: Record<string, string | number>) => {
    let result: string = COPY[lang]?.[key] ?? COPY.ru[key];
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        result = result.replaceAll(`{${k}}`, String(v));
      });
    }
    return result;
  };
  const getWordStatusLabel = (status: WordStatus) => {
    if (status === 'learned') return t('learned');
    if (status === 'due') return t('dueToday');
    return lang === 'uz' ? "O'rganilmagan" : 'Не выучено';
  };
  const formatDateTime = (value?: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  };

  const broadcastLimit = adminBroadcastPhoto.trim() ? 1024 : 4000;
  const broadcastLength = adminBroadcastMessage.trim().length;
  const broadcastOverLimit = broadcastLength > broadcastLimit;
  const broadcastCounter = `${broadcastLength}/${broadcastLimit}`;
  const cacheTsRef = useRef({
    me: 0,
    settings: 0,
    stats: 0,
    adminOverview: 0,
  });
  const wordsCacheRef = useRef<Map<string, { items: WordItem[]; loadedAt: number }>>(new Map());
  const skipWordsDebounceOnceRef = useRef(false);
  const wordsRequestTokenRef = useRef(0);
  const isFresh = (timestamp: number) => (Date.now() - timestamp) < DATA_CACHE_TTL_MS;

  const loadMe = async (force = false) => {
    if (!force && me && isFresh(cacheTsRef.current.me)) return;
    try {
      const data = await api.getMe();
      setMe(data);
      const value = data.language === 'uz' ? 'uz' : 'ru';
      setLangOverride(value);
      cacheTsRef.current.me = Date.now();
    } catch {
      // keep default language
    }
  };

  const setLangOverride = (value: Lang) => {
    setLang(value);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANG_STORAGE_KEY, value);
    }
  };

  const persistLanguage = async (value: Lang) => {
    setLangOverride(value);
    if (!canAuth) return;
    try {
      const data = await api.updateMe({ language: value });
      const normalized = data.language === 'uz' ? 'uz' : 'ru';
      setLangOverride(normalized);
      setMe(data);
      cacheTsRef.current.me = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveLanguageError'));
    }
  };

  const buildReferralLink = () => {
    if (!BOT_USERNAME) return '';
    const rawId = me?.id ? Number(me.id) : telegramUser?.id ?? (devUserId ? Number(devUserId) : null);
    const hasId = typeof rawId === 'number' && Number.isFinite(rawId) && rawId > 0;
    const startParam = hasId ? `ref_${rawId}` : 'ref_0';
    return `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(startParam)}`;
  };

  const handleInvite = () => {
    const link = buildReferralLink();
    if (!link) {
      setError(t('inviteMissingBot'));
      return;
    }
    const tg = (window as any)?.Telegram?.WebApp;
    const shareText = t('inviteShareText');
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(shareUrl);
      return;
    }
    if (navigator.share) {
      navigator
        .share({ text: shareText, url: link })
        .catch(() => { });
      return;
    }
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    const tg = (window as any)?.Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('wordping.theme');
    }
    const tg = (window as any)?.Telegram?.WebApp;
    if (tg) {
      const bg = '#0b0f14';
      tg.setHeaderColor?.(bg);
      tg.setBackgroundColor?.(bg);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (useLiteUi) {
      document.documentElement.setAttribute('data-lite-ui', 'true');
      return;
    }
    document.documentElement.removeAttribute('data-lite-ui');
  }, [useLiteUi]);

  useEffect(() => {
    if (!canAuth) {
      setNotice(t('noticeAuth'));
      return;
    }
    setNotice((prev) => {
      const authRu = COPY.ru.noticeAuth;
      const authUz = COPY.uz.noticeAuth;
      if (prev === authRu || prev === authUz) return '';
      return prev;
    });
  }, [canAuth, lang]);

  useEffect(() => {
    if (!canAuth) return;
    void loadMe();
  }, [canAuth]);

  useEffect(() => {
    if (!canAuth) return;
    if (tab === 'settings') {
      void loadSettings();
    }
    if (tab === 'stats') {
      void loadStats();
    }
    if (tab === 'admin' && isAdmin) {
      void loadAdminOverview();
    }
    if (tab === 'words') {
      skipWordsDebounceOnceRef.current = true;
      void loadWords(query);
    }
  }, [tab, canAuth, isAdmin]);

  useEffect(() => {
    if (tab !== 'words' || !canAuth) return;
    if (skipWordsDebounceOnceRef.current) {
      skipWordsDebounceOnceRef.current = false;
      return;
    }
    const handle = setTimeout(() => {
      void loadWords(query);
    }, 250);
    return () => clearTimeout(handle);
  }, [query, tab, canAuth]);

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  const loadSettings = async (force = false) => {
    if (!force && settings && isFresh(cacheTsRef.current.settings)) return;
    try {
      setLoading(true);
      setError('');
      const data = await api.getSettings();
      setSettings(data);
      cacheTsRef.current.settings = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadSettingsError'));
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (force = false) => {
    if (!force && stats && isFresh(cacheTsRef.current.stats)) return;
    try {
      setLoading(true);
      setError('');
      const data = await api.getStats();
      setStats(data);
      cacheTsRef.current.stats = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadStatsError'));
    } finally {
      setLoading(false);
    }
  };

  const loadWords = async (q?: string, force = false) => {
    const normalizedQuery = (q ?? '').trim();
    const cacheKey = normalizedQuery.toLowerCase();
    const cached = wordsCacheRef.current.get(cacheKey);
    if (!force && cached && isFresh(cached.loadedAt)) {
      setWords(cached.items);
      return;
    }
    const requestToken = wordsRequestTokenRef.current + 1;
    wordsRequestTokenRef.current = requestToken;
    try {
      setLoading(true);
      setError('');
      const data = await api.getWords(normalizedQuery || undefined);
      if (requestToken !== wordsRequestTokenRef.current) return;
      setWords(data.items);
      wordsCacheRef.current.set(cacheKey, { items: data.items, loadedAt: Date.now() });
      if (wordsCacheRef.current.size > 20) {
        const oldestKey = wordsCacheRef.current.keys().next().value as string | undefined;
        if (oldestKey) wordsCacheRef.current.delete(oldestKey);
      }
    } catch (err) {
      if (requestToken !== wordsRequestTokenRef.current) return;
      setError(err instanceof Error ? err.message : t('loadWordsError'));
    } finally {
      if (requestToken !== wordsRequestTokenRef.current) return;
      setLoading(false);
    }
  };

  const loadAdminOverview = async (force = false) => {
    if (!isAdmin) return;
    if (!force && adminOverview && isFresh(cacheTsRef.current.adminOverview)) return;
    try {
      setAdminOverviewLoading(true);
      setAdminOverviewError('');
      const data = await api.getAdminOverview();
      setAdminOverview(data);
      cacheTsRef.current.adminOverview = Date.now();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('adminOverviewError');
      const normalized = message === 'forbidden' || message === 'unauthorized' ? t('adminOverviewError') : message;
      setAdminOverviewError(normalized);
    } finally {
      setAdminOverviewLoading(false);
    }
  };

  const loadAdminUser = async (overrideId?: string) => {
    if (!isAdmin) return;
    const raw = (overrideId ?? adminQuery).trim();
    if (!raw) return;
    try {
      setAdminLookupLoading(true);
      setAdminLookupError('');
      setAdminNotFound(false);
      setAdminUser(null);
      const data = await api.getAdminUser(raw);
      setAdminUser(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('adminLookupError');
      if (message === 'not_found' || message.includes('404')) {
        setAdminNotFound(true);
      } else {
        const normalized = message === 'forbidden' || message === 'unauthorized' ? t('adminLookupError') : message;
        setAdminLookupError(normalized);
      }
    } finally {
      setAdminLookupLoading(false);
    }
  };

  const sendAdminBroadcast = async () => {
    if (!isAdmin) return;
    const text = adminBroadcastMessage.trim();
    const photo = adminBroadcastPhoto.trim();
    if (!text && !photo) {
      setAdminBroadcastError(t('adminBroadcastError'));
      return;
    }
    if (broadcastOverLimit) {
      setAdminBroadcastError('Слишком длинное сообщение');
      return;
    }
    let recipientsCount = adminOverview?.totals.users;
    if (!Number.isFinite(recipientsCount)) {
      try {
        const freshOverview = await api.getAdminOverview();
        setAdminOverview(freshOverview);
        cacheTsRef.current.adminOverview = Date.now();
        recipientsCount = freshOverview.totals.users;
      } catch {
        // fallback to generic confirm text
      }
    }

    const confirmText = Number.isFinite(recipientsCount)
      ? t('adminBroadcastConfirmCount', { count: recipientsCount as number })
      : t('adminBroadcastConfirm');
    if (!confirm(confirmText)) return;

    try {
      setAdminBroadcastLoading(true);
      setAdminBroadcastError('');
      setAdminBroadcastNotice('');
      const result = await api.sendAdminBroadcast({ message: text, photoUrl: photo || undefined });
      setAdminBroadcastMessage('');
      setAdminBroadcastPhoto('');
      setAdminBroadcastNotice(`${t('adminBroadcastSent')} (${result.sent}/${result.total})`);
      setTimeout(() => setAdminBroadcastNotice(''), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('adminBroadcastError');
      if (message === 'message_too_long' || message === 'caption_too_long') {
        setAdminBroadcastError('Слишком длинное сообщение');
      } else if (message === 'empty_message') {
        setAdminBroadcastError(t('adminBroadcastError'));
      } else {
        setAdminBroadcastError(message);
      }
    } finally {
      setAdminBroadcastLoading(false);
    }
  };

  const clearAdminSearch = () => {
    setAdminQuery('');
    setAdminUser(null);
    setAdminNotFound(false);
    setAdminLookupError('');
  };

  const saveSettings = async () => {
    if (!form) return;
    try {
      setLoading(true);
      setError('');
      const data = await api.updateSettings(form);
      setSettings(data);
      cacheTsRef.current.settings = Date.now();
      setNotice(t('saved'));
      setTimeout(() => setNotice(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveSettingsError'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      setLoading(true);
      setError('');
      await api.deleteWord(id);
      setWords((prev) => prev.filter((item) => item.id !== id));
      wordsCacheRef.current.forEach((entry, key) => {
        const filtered = entry.items.filter((item) => item.id !== id);
        wordsCacheRef.current.set(key, { ...entry, items: filtered, loadedAt: Date.now() });
      });
      cacheTsRef.current.stats = 0;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deleteError'));
    } finally {
      setLoading(false);
    }
  };

  const displayName = telegramUser
    ? `${telegramUser.first_name ?? ''} ${telegramUser.last_name ?? ''}`.trim() || telegramUser.username || t('userFallback')
    : adminCandidateId
      ? `${isAdmin ? t('adminLabel') : t('userIdLabel')} #${adminCandidateId}`
      : t('userFallback');

  return (

    <div className="app">
      <div className="header">
        <div className="header-right">
          <div className="brand">
            <img src="/logo.svg" className="brand-logo" alt="WordPing" />
          </div>
          {tab === 'stats' && <div className="user-pill">{displayName}</div>}
        </div>
      </div>

      <>
        {tab === 'stats' && (
          <div
            key="stats"
            className="section"
          >
            {stats ? (
              <>
                <div className="panel hero-panel">
                  <div className="streak-hero">
                    <div className="streak-main">
                      <span className={`streak-flame ${stats.streakCount > 0 ? 'is-lit' : ''}`}>
                        <Flame size={26} />
                      </span>
                      <div className="streak-count">
                        <h1>{stats.streakCount}</h1>
                      </div>
                    </div>
                    <span className="streak-subtitle">{t('streakSubtitle')}</span>
                    {stats.streakCount === 0 && (
                      <small className="streak-tip">{t('streakTip')}</small>
                    )}
                  </div>

                  <div className="milestones">
                    <div className={`milestone ${stats.streakCount >= 7 ? 'active' : ''}`}>
                      <div className="milestone-circle">7</div>
                      <span className="milestone-label">7 {t('milestoneDays')}</span>
                    </div>
                    <div className={`milestone ${stats.streakCount >= 14 ? 'active' : ''}`}>
                      <div className="milestone-circle">14</div>
                      <span className="milestone-label">14 {t('milestoneDays')}</span>
                    </div>
                    <div className={`milestone ${stats.streakCount >= 30 ? 'active' : ''}`}>
                      <div className="milestone-circle">30</div>
                      <span className="milestone-label">30 {t('milestoneDays')}</span>
                    </div>
                    <div className={`milestone ${stats.streakCount >= 100 ? 'active' : ''}`}>
                      <div className="milestone-circle">100</div>
                      <span className="milestone-label">100 {t('milestoneDays')}</span>
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <h2><Target size={20} /> {t('progress')}</h2>
                  <div className="stat-grid">
                    <div className="stat-card stat-card--today">
                      <div className="stat-emoji stat-emoji--today"><Target size={18} strokeWidth={2.2} /></div>
                      <span>{t('doneToday')}</span>
                      <strong>{stats.doneTodayCount} / {stats.dailyLimit}</strong>
                    </div>
                    <div className="stat-card stat-card--dictionary">
                      <div className="stat-emoji stat-emoji--dictionary"><Book size={18} strokeWidth={2.2} /></div>
                      <span>{t('dictionary')}</span>
                      <strong>{stats.words}</strong>
                    </div>
                    <div className="stat-card stat-card--due">
                      <div className="stat-emoji stat-emoji--due"><Clock size={18} strokeWidth={2.2} /></div>
                      <span>{t('dueToday')}</span>
                      <strong>{stats.dueToday}</strong>
                    </div>
                    <div className="stat-card stat-card--learned">
                      <div className="stat-emoji stat-emoji--learned"><CheckCircle2 size={18} strokeWidth={2.2} /></div>
                      <span>{t('learned')}</span>
                      <strong>{stats.learnedCount}</strong>
                    </div>
                  </div>
                </div>

                <div className="invite-row">
                  <button className="invite-cta invite-cta--full" onClick={handleInvite}>
                    <span className="invite-cta-main">
                      <UserPlus size={18} />
                      <span>{t('inviteButton')}</span>
                    </span>
                    <span className="invite-cta-badge">{me?.referralCount ?? 0}</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="notice" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}>
                {t('statsLoading')}
              </div>
            )}
          </div>
        )}

        {tab === 'words' && (
          <div
            key="words"
            className="section"
          >
            <div className="panel" style={{ minHeight: '80vh' }}>
              <h2><Search size={20} /> {t('wordsTitle')}</h2>
              <div className="field word-search">
                <input
                  type="text"
                  placeholder={t('wordsSearch')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="word-list" style={{ marginTop: 16 }}>
                {words.length === 0 && !loading && (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    <div style={{ marginBottom: 10 }}><BookOpen size={34} /></div>
                    {t('wordsEmpty')}
                  </div>
                )}
                {words.map((word) => {
                  const wordStatus = resolveWordStatus(word);
                  return (
                    <div key={word.id} className="word-item">
                      <div className="word-main">
                        <strong>{word.wordEn}</strong>
                        <small>{word.translationRu}</small>
                      </div>
                      <div className="word-actions">
                        <span className={`word-status word-status--${wordStatus}`}>
                          {getWordStatusLabel(wordStatus)}
                        </span>
                        <button className="btn-danger btn-danger-icon" onClick={() => handleDelete(word.id)}>
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div
            key="settings"
            className="section"
          >
            <div className="panel">
              <h2><Bell size={20} className="text-primary" /> {t('settingsTitle')}</h2>
              {form ? (
                <div className="grid">
                  <div className="checkbox-field">
                    <label>{t('notifyToggle')}</label>
                    <label className="checkbox-wrapper">
                      <input
                        type="checkbox"
                        checked={form.notificationsEnabled}
                        onChange={(e) => setForm({ ...form, notificationsEnabled: e.target.checked })}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="field">
                    <label>{t('intervalLabel')}</label>
                    <input
                      type="number"
                      min={5}
                      max={240}
                      value={form.notificationIntervalMinutes}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          notificationIntervalMinutes: Number(e.target.value),
                        })
                      }
                    />
                  </div>

                  <div className="field">
                    <label>{t('limitLabel')}</label>
                    <input
                      type="number"
                      min={5}
                      max={40}
                      value={form.maxNotificationsPerDay}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          maxNotificationsPerDay: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="notice" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}>{t('settingsLoading')}</div>
              )}
            </div>

            <div className="panel">
              <h2><Clock size={20} /> {t('quietHours')}</h2>
              {form ? (
                <div className="grid two">
                  <div className="field">
                    <label>{t('quietStart')}</label>
                    <input
                      type="time"
                      value={minutesToTime(form.quietHoursStartMinutes)}
                      onChange={(e) => {
                        const minutes = timeToMinutes(e.target.value);
                        if (minutes !== null) {
                          setForm({ ...form, quietHoursStartMinutes: minutes });
                        }
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>{t('quietEnd')}</label>
                    <input
                      type="time"
                      value={minutesToTime(form.quietHoursEndMinutes)}
                      onChange={(e) => {
                        const minutes = timeToMinutes(e.target.value);
                        if (minutes !== null) {
                          setForm({ ...form, quietHoursEndMinutes: minutes });
                        }
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="notice" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}>{t('settingsLoading')}</div>
              )}
            </div>

            <div className="actions settings-actions">
              <button className="btn-primary" onClick={saveSettings} disabled={loading}>
                <Save size={18} /> {t('save')}
              </button>
            </div>
            <div className="actions settings-actions settings-actions--secondary">
              <button
                type="button"
                className="chip-btn settings-lang-btn"
                onClick={() => persistLanguage(lang === 'ru' ? 'uz' : 'ru')}
              >
                <Languages size={16} />
                <span>{lang === 'ru' ? t('languageRu') : t('languageUz')}</span>
              </button>
            </div>
          </div>
        )}

        {tab === 'admin' && isAdmin && (
          <div
            key="admin"
            className="section section--admin"
          >
            <div className="admin-shell">
              <div className="panel admin-top-panel">
                <div className="admin-top-head">
                  <h2 className="admin-title">
                    <Shield size={18} />
                    {t('adminTitle')}
                  </h2>
                  <button
                    type="button"
                    className="btn-ghost btn-compact admin-refresh-btn"
                    onClick={() => void loadAdminOverview(true)}
                    disabled={adminOverviewLoading}
                  >
                    <RotateCcw size={15} className={adminOverviewLoading ? 'spin' : ''} />
                    <span className="admin-refresh-label">{t('adminOverview')}</span>
                  </button>
                </div>

                {adminOverview ? (
                  <div className="admin-metrics">
                    <div className="admin-metric admin-metric--users">
                      <div className="admin-metric-icon"><Users size={18} strokeWidth={2.2} /></div>
                      <span>{t('adminTotalUsers')}</span>
                      <strong>{adminOverview.totals.users}</strong>
                    </div>
                    <div className="admin-metric admin-metric--active">
                      <div className="admin-metric-icon"><Zap size={18} strokeWidth={2.2} /></div>
                      <span>{t('adminActiveToday')}</span>
                      <strong>{adminOverview.activeToday}</strong>
                    </div>
                    <div className="admin-metric admin-metric--new">
                      <div className="admin-metric-icon"><UserPlus size={18} strokeWidth={2.2} /></div>
                      <span>{t('adminNew7Days')}</span>
                      <strong>{adminOverview.newLast7Days}</strong>
                    </div>
                    <div className="admin-metric admin-metric--words">
                      <div className="admin-metric-icon"><Book size={18} strokeWidth={2.2} /></div>
                      <span>{t('adminTotalWords')}</span>
                      <strong>{adminOverview.totals.words}</strong>
                    </div>
                    <div className="admin-metric admin-metric--notify">
                      <div className="admin-metric-icon"><Bell size={18} strokeWidth={2.2} /></div>
                      <span>{t('adminNotificationsToday')}</span>
                      <strong>{adminOverview.totals.notificationsSentToday}</strong>
                    </div>
                  </div>
                ) : (
                  <div className={`admin-state ${adminOverviewError ? 'admin-state--error' : 'admin-state--loading'}`}>
                    {adminOverviewError ? adminOverviewError : t('adminOverviewLoading')}
                  </div>
                )}
              </div>

              <div className="admin-main-grid">
                <div className="panel admin-block">
                  <h2><Search size={18} /> {t('adminLookupTitle')}</h2>
                  <div className="admin-search">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder={t('adminSearchPlaceholder')}
                      value={adminQuery}
                      onChange={(e) => {
                        setAdminQuery(e.target.value);
                        if (adminNotFound) setAdminNotFound(false);
                        if (adminLookupError) setAdminLookupError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void loadAdminUser();
                        }
                      }}
                    />
                    <div className="admin-search-actions">
                      <button
                        type="button"
                        className="btn-primary btn-compact"
                        onClick={() => void loadAdminUser()}
                        disabled={adminLookupLoading || !adminQuery.trim()}
                      >
                        {adminLookupLoading ? t('adminLookupLoading') : t('adminSearchAction')}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-compact"
                        onClick={clearAdminSearch}
                        disabled={!adminQuery && !adminUser}
                      >
                        {t('adminSearchClear')}
                      </button>
                    </div>
                  </div>
                  {adminLookupLoading && (
                    <div className="admin-state admin-state--loading">{t('adminLookupLoading')}</div>
                  )}
                  {adminLookupError && (
                    <div className="admin-state admin-state--error">{adminLookupError || t('adminLookupError')}</div>
                  )}
                  {adminNotFound && (
                    <div className="admin-state admin-state--error">{t('adminNotFound')}</div>
                  )}

                  {adminUser && (
                    <div className="admin-user-card admin-user-card--clean">
                      <div className="admin-user-header">
                        <div className="admin-user-left">
                          <div className="admin-user-label">{t('adminUserDetails')}</div>
                          <div className="admin-user-id-row">
                            <div className="admin-user-id">{adminUser.id}</div>
                          </div>
                        </div>
                        <div className="admin-user-date">
                          <span>{t('adminFieldCreated')}</span>
                          <strong>{formatDateTime(adminUser.createdAt)}</strong>
                        </div>
                      </div>

                      <div className="admin-user-grid">
                        <div className="admin-user-item">
                          <span>{t('adminFieldWords')}</span>
                          <strong>{adminUser.wordsCount}</strong>
                        </div>
                        <div className="admin-user-item">
                          <span>{t('adminFieldLearned')}</span>
                          <strong>{adminUser.learnedCount}</strong>
                        </div>
                        <div className="admin-user-item">
                          <span>{t('adminFieldPostponed')}</span>
                          <strong>{adminUser.postponedCount}</strong>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="panel admin-block">
                  <h2><Bell size={18} /> {t('adminBroadcastTitle')}</h2>
                  <div className="admin-message">
                    <textarea
                      rows={4}
                      placeholder={t('adminBroadcastPlaceholder')}
                      value={adminBroadcastMessage}
                      onChange={(e) => {
                        setAdminBroadcastMessage(e.target.value);
                        if (adminBroadcastError) setAdminBroadcastError('');
                      }}
                    />
                    <div className={`admin-counter ${broadcastOverLimit ? 'is-warn' : ''}`}>
                      {broadcastCounter}
                    </div>
                    <div className="admin-message-row">
                      <label>{t('adminBroadcastPhotoLabel')}</label>
                      <input
                        type="text"
                        placeholder="https://example.com/photo.jpg"
                        value={adminBroadcastPhoto}
                        onChange={(e) => {
                          setAdminBroadcastPhoto(e.target.value);
                          if (adminBroadcastError) setAdminBroadcastError('');
                        }}
                      />
                      <small>{t('adminBroadcastPhotoHint')}</small>
                    </div>
                    <button
                      type="button"
                      className="btn-primary btn-compact btn-admin-send"
                      onClick={() => void sendAdminBroadcast()}
                      disabled={adminBroadcastLoading || broadcastOverLimit || (!adminBroadcastMessage.trim() && !adminBroadcastPhoto.trim())}
                    >
                      {adminBroadcastLoading ? t('adminBroadcastSending') : t('adminBroadcastSend')}
                    </button>
                  </div>
                  {adminBroadcastNotice && (
                    <div className="admin-message-note">{adminBroadcastNotice}</div>
                  )}
                  {adminBroadcastError && (
                    <div className="admin-state admin-state--error">{adminBroadcastError}</div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
      </>

      {notice && (
        <div
          className="notice"
        >
          <CheckCircle2 size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
          {notice}
        </div>
      )}
      {error && (
        <div
          className="notice"
          style={{ color: '#ef4444', borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)' }}
        >
          <AlertCircle size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
          {error}
        </div>
      )}

      <div className="tabs-container">
        <button type="button" className={`tab-btn ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
          <span className="tab-icon"><House size={20} strokeWidth={2.1} /></span>
          <span className="tab-label">{t('tabHome')}</span>
        </button>
        <button type="button" className={`tab-btn ${tab === 'words' ? 'active' : ''}`} onClick={() => setTab('words')}>
          <span className="tab-icon"><BookOpen size={20} strokeWidth={2.1} /></span>
          <span className="tab-label">{t('tabDictionary')}</span>
        </button>
        <button type="button" className={`tab-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          <span className="tab-icon"><SettingsIcon size={20} strokeWidth={2.1} /></span>
          <span className="tab-label">{t('tabSettings')}</span>
        </button>
        {isAdmin && (
          <button type="button" className={`tab-btn ${tab === 'admin' ? 'active' : ''}`} onClick={() => setTab('admin')}>
            <span className="tab-icon"><Shield size={20} strokeWidth={2.1} /></span>
            <span className="tab-label">{t('tabAdmin')}</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default App;
