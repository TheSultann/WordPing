import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { api, Settings, Stats, WordItem, Me, AdminOverview, AdminUserSummary } from './api';
import {
  Settings as SettingsIcon,
  BookOpen,
  House,
  Shield,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import StatsSection from './components/StatsSection';

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
    doneToday: '\u0421\u0434\u0435\u043b\u0430\u043d\u043e \u0441\u0435\u0433\u043e\u0434\u043d\u044f',
    waitingToday: '\u0416\u0434\u0443\u0442 \u0441\u0435\u0433\u043e\u0434\u043d\u044f',
    answeredToday: '\u041e\u0442\u0432\u0435\u0447\u0435\u043d\u043e \u0441\u0435\u0433\u043e\u0434\u043d\u044f',
    accuracyToday: '\u0422\u043e\u0447\u043d\u043e\u0441\u0442\u044c \u0441\u0435\u0433\u043e\u0434\u043d\u044f',
    notifications: '\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f',
    dictionary: 'Словарь',
    dueToday: 'На повтор',
    dueNow: 'К повторению',
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
    waitingToday: 'Bugun kutilmoqda',
    answeredToday: 'Bugun javob berildi',
    accuracyToday: 'Bugungi aniqlik',
    notifications: 'Bildirishnomalar',
    dictionary: "Lug'at",
    dueToday: "Qayta ko'rish",
    dueNow: 'Qaytarish kerak',
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
const ADMIN_CACHE_KEY_PREFIX = 'wordping.is_admin.';
const DATA_CACHE_TTL_MS = 30_000;
const LEARNED_STAGE_MIN = 4;
const ADMIN_USERS_FIRST_PAGE_SIZE = 3;
const ADMIN_USERS_NEXT_PAGE_SIZE = 15;
const WORDS_PAGE_SIZE = 25;
const STATIC_ADMIN_TELEGRAM_ID = String((import.meta as any).env?.VITE_ADMIN_TELEGRAM_ID ?? '').trim();
const WordsSection = lazy(() => import('./components/WordsSection'));
const SettingsSection = lazy(() => import('./components/SettingsSection'));
const AdminSection = lazy(() => import('./components/AdminSection'));

const resolveWordStatus = (word: WordItem): WordStatus => {
  if ((word.stage ?? 0) >= LEARNED_STAGE_MIN) return 'learned';
  if (word.nextReviewAt) {
    const nextReviewAtMs = Date.parse(word.nextReviewAt);
    if (Number.isFinite(nextReviewAtMs) && nextReviewAtMs <= Date.now()) {
      return 'due';
    }
  }
  return 'new';
};

const getStoredLang = (): Lang | null => {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(LANG_STORAGE_KEY);
  return value === 'uz' || value === 'ru' ? value : null;
};

const normalizeUserId = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d+$/.test(text)) return text;
  }
  return null;
};

const adminCacheKey = (userId: string) => `${ADMIN_CACHE_KEY_PREFIX}${userId}`;

const readCachedAdminFlag = (userId: string | null): boolean | null => {
  if (typeof window === 'undefined' || !userId) return null;
  const value = window.localStorage.getItem(adminCacheKey(userId));
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
};

const writeCachedAdminFlag = (userId: string | null, isAdmin: boolean) => {
  if (typeof window === 'undefined' || !userId) return;
  window.localStorage.setItem(adminCacheKey(userId), isAdmin ? '1' : '0');
};

const isStaticAdminUser = (userId: string | null): boolean => {
  if (!userId || !STATIC_ADMIN_TELEGRAM_ID) return false;
  return userId === STATIC_ADMIN_TELEGRAM_ID;
};

const getInitialAdminHint = (): boolean => {
  if (typeof window === 'undefined') return false;
  const initTelegramId = normalizeUserId((window as any)?.Telegram?.WebApp?.initDataUnsafe?.user?.id);
  const initDevId = normalizeUserId(new URLSearchParams(window.location.search).get('devUserId'));
  const userId = initTelegramId ?? initDevId;
  const cached = readCachedAdminFlag(userId);
  if (cached !== null) return cached;
  return isStaticAdminUser(userId);
};

const App = () => {
  const [tab, setTab] = useState<'settings' | 'stats' | 'words' | 'admin'>('stats');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [intervalInput, setIntervalInput] = useState('');
  const [limitInput, setLimitInput] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [words, setWords] = useState<WordItem[]>([]);
  const [wordsOffset, setWordsOffset] = useState(0);
  const [wordsHasMore, setWordsHasMore] = useState(false);
  const [wordsLoadingMore, setWordsLoadingMore] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lang, setLang] = useState<Lang>(() => getStoredLang() ?? 'ru');
  const [isAdminHint, setIsAdminHint] = useState<boolean>(() => getInitialAdminHint());
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [adminOverviewLoading, setAdminOverviewLoading] = useState(false);
  const [adminOverviewError, setAdminOverviewError] = useState('');
  const [adminQuery, setAdminQuery] = useState('');
  const [adminUser, setAdminUser] = useState<AdminUserSummary | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUsersError, setAdminUsersError] = useState('');
  const [adminUsersOffset, setAdminUsersOffset] = useState(0);
  const [adminUsersHasMore, setAdminUsersHasMore] = useState(false);
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
  const authUserId = normalizeUserId(telegramUser?.id ?? devUserId);
  const canAuth = hasInitData || Boolean(devUserId);
  const isAdmin = me?.isAdmin ?? isAdminHint;

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
    if (status === 'due') return t('dueNow');
    return lang === 'uz' ? "O'rganilmagan" : 'Не выучено';
  };
  const formatDateTime = (value?: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  };

  const formatDateOnly = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString();
  };

  const formatAdminName = (user: AdminUserSummary) => {
    const display = (user.displayName ?? '').trim();
    if (display) return display;
    const firstLast = `${user.tgFirstName ?? ''} ${user.tgLastName ?? ''}`.trim();
    if (firstLast) return firstLast;
    if (user.tgUsername) return `@${user.tgUsername}`;
    return lang === 'uz' ? 'Nomsiz' : 'Без имени';
  };

  const formatAdminCardPrimaryName = (user: AdminUserSummary) => {
    const display = (user.displayName ?? '').trim();
    if (display) return display;
    return `${user.tgFirstName ?? ''} ${user.tgLastName ?? ''}`.trim();
  };

  const sanitizeNumericInput = (value: string) => {
    const digits = value.replace(/\D+/g, '');
    if (!digits) return '';
    return digits.replace(/^0+(?=\d)/, '');
  };

  const parseDraftNumber = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const handleToggleNotifications = (checked: boolean) => {
    if (!form) return;
    setForm({ ...form, notificationsEnabled: checked });
  };

  const handleIntervalInputChange = (value: string) => {
    if (!form) return;
    const raw = sanitizeNumericInput(value);
    setIntervalInput(raw);
    const parsed = parseDraftNumber(raw);
    if (parsed !== null) {
      setForm({
        ...form,
        notificationIntervalMinutes: parsed,
      });
    }
  };

  const handleIntervalInputBlur = () => {
    if (!form) return;
    const parsed = parseDraftNumber(intervalInput);
    if (parsed === null) {
      setIntervalInput(String(form.notificationIntervalMinutes));
      return;
    }
    setIntervalInput(String(parsed));
  };

  const handleLimitInputChange = (value: string) => {
    if (!form) return;
    const raw = sanitizeNumericInput(value);
    setLimitInput(raw);
    const parsed = parseDraftNumber(raw);
    if (parsed !== null) {
      setForm({
        ...form,
        maxNotificationsPerDay: parsed,
      });
    }
  };

  const handleLimitInputBlur = () => {
    if (!form) return;
    const parsed = parseDraftNumber(limitInput);
    if (parsed === null) {
      setLimitInput(String(form.maxNotificationsPerDay));
      return;
    }
    setLimitInput(String(parsed));
  };

  const handleQuietStartChange = (value: string) => {
    if (!form) return;
    const minutes = timeToMinutes(value);
    if (minutes !== null) {
      setForm({ ...form, quietHoursStartMinutes: minutes });
    }
  };

  const handleQuietEndChange = (value: string) => {
    if (!form) return;
    const minutes = timeToMinutes(value);
    if (minutes !== null) {
      setForm({ ...form, quietHoursEndMinutes: minutes });
    }
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
  const wordsCacheRef = useRef<Map<string, { items: WordItem[]; hasMore: boolean; offset: number; loadedAt: number }>>(new Map());
  const skipWordsDebounceOnceRef = useRef(false);
  const wordsRequestTokenRef = useRef(0);
  const isFresh = (timestamp: number) => (Date.now() - timestamp) < DATA_CACHE_TTL_MS;

  const loadMe = async (force = false) => {
    if (!force && me && isFresh(cacheTsRef.current.me)) return;
    try {
      const data = await api.getMe();
      setMe(data);
      const serverIsAdmin = Boolean(data.isAdmin);
      setIsAdminHint(serverIsAdmin);
      writeCachedAdminFlag(authUserId ?? normalizeUserId(data.id), serverIsAdmin);
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
    const cached = readCachedAdminFlag(authUserId);
    if (cached !== null) {
      setIsAdminHint(cached);
      return;
    }
    setIsAdminHint(isStaticAdminUser(authUserId));
  }, [authUserId]);

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
    void import('./components/WordsSection');
    void import('./components/SettingsSection');
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void import('./components/AdminSection');
  }, [isAdmin]);

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
      void loadAdminUsers();
    }
    if (tab === 'words') {
      void loadStats();
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
      setIntervalInput(String(settings.notificationIntervalMinutes));
      setLimitInput(String(settings.maxNotificationsPerDay));
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
      setWordsOffset(cached.offset);
      setWordsHasMore(cached.hasMore);
      return;
    }
    const requestToken = wordsRequestTokenRef.current + 1;
    wordsRequestTokenRef.current = requestToken;
    try {
      setLoading(true);
      setWordsLoadingMore(false);
      setError('');
      const data = await api.getWords(normalizedQuery || undefined, WORDS_PAGE_SIZE, 0);
      if (requestToken !== wordsRequestTokenRef.current) return;
      setWords(data.items);
      setWordsOffset(data.items.length);
      setWordsHasMore(Boolean(data.hasMore));
      wordsCacheRef.current.set(cacheKey, {
        items: data.items,
        hasMore: Boolean(data.hasMore),
        offset: data.items.length,
        loadedAt: Date.now(),
      });
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

  const loadMoreWords = async () => {
    if (wordsLoadingMore || !wordsHasMore) return;
    const normalizedQuery = query.trim();
    const cacheKey = normalizedQuery.toLowerCase();
    const requestToken = wordsRequestTokenRef.current + 1;
    wordsRequestTokenRef.current = requestToken;
    try {
      setWordsLoadingMore(true);
      setError('');
      const data = await api.getWords(normalizedQuery || undefined, WORDS_PAGE_SIZE, wordsOffset);
      if (requestToken !== wordsRequestTokenRef.current) return;
      setWords((prev) => {
        const merged = [...prev, ...data.items];
        wordsCacheRef.current.set(cacheKey, {
          items: merged,
          hasMore: Boolean(data.hasMore),
          offset: merged.length,
          loadedAt: Date.now(),
        });
        return merged;
      });
      setWordsOffset((prev) => prev + data.items.length);
      setWordsHasMore(Boolean(data.hasMore));
    } catch (err) {
      if (requestToken !== wordsRequestTokenRef.current) return;
      setError(err instanceof Error ? err.message : t('loadWordsError'));
    } finally {
      setWordsLoadingMore(false);
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

  const loadAdminUsers = async (
    overrideQuery?: string,
    options?: { append?: boolean }
  ) => {
    if (!isAdmin) return [] as AdminUserSummary[];
    const raw = (overrideQuery ?? adminQuery).trim();
    const append = options?.append ?? false;
    const offset = append ? adminUsersOffset : 0;
    const limit = append ? ADMIN_USERS_NEXT_PAGE_SIZE : ADMIN_USERS_FIRST_PAGE_SIZE;
    try {
      setAdminUsersLoading(true);
      setAdminUsersError('');
      const response = await api.getAdminUsers(raw || undefined, limit, offset);
      const list = response.items ?? [];
      setAdminUsers((prev) => (append ? [...prev, ...list] : list));
      setAdminUsersOffset(offset + list.length);
      setAdminUsersHasMore(response.hasMore);
      if (!append) {
        setAdminNotFound(Boolean(raw) && list.length === 0);
      }
      return list;
    } catch (err) {
      const message = err instanceof Error ? err.message : t('adminLookupError');
      const normalized = message === 'forbidden' || message === 'unauthorized' ? t('adminLookupError') : message;
      setAdminUsersError(normalized);
      if (!append) {
        setAdminUsers([]);
        setAdminUsersOffset(0);
        setAdminUsersHasMore(false);
      }
      return [] as AdminUserSummary[];
    } finally {
      setAdminUsersLoading(false);
    }
  };

  const openAdminUser = async (id: string) => {
    if (!isAdmin) return;
    try {
      setAdminLookupLoading(true);
      setAdminLookupError('');
      setAdminNotFound(false);
      const data = await api.getAdminUser(id);
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

  const loadAdminUser = async (overrideId?: string) => {
    if (!isAdmin) return;
    const raw = (overrideId ?? adminQuery).trim();
    setAdminUser(null);
    setAdminLookupError('');
    if (!raw) {
      await loadAdminUsers('');
      return;
    }
    const list = await loadAdminUsers(raw);
    if (/^\d+$/.test(raw)) {
      await openAdminUser(raw);
      return;
    }
    if (list.length === 1) {
      await openAdminUser(list[0].id);
    }
  };

  const loadMoreAdminUsers = async () => {
    if (adminUsersLoading || !adminUsersHasMore) return;
    await loadAdminUsers(undefined, { append: true });
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
    setAdminUsersError('');
    setAdminUsersOffset(0);
    setAdminUsersHasMore(false);
    setAdminNotFound(false);
    setAdminLookupError('');
    void loadAdminUsers('');
  };

  const saveSettings = async () => {
    if (!form) return;
    const notificationIntervalMinutes = parseDraftNumber(intervalInput) ?? form.notificationIntervalMinutes;
    const maxNotificationsPerDay = parseDraftNumber(limitInput) ?? form.maxNotificationsPerDay;
    const payload: Settings = {
      ...form,
      notificationIntervalMinutes,
      maxNotificationsPerDay,
    };
    try {
      setLoading(true);
      setError('');
      const data = await api.updateSettings(payload);
      setSettings(data);
      setForm(data);
      setIntervalInput(String(data.notificationIntervalMinutes));
      setLimitInput(String(data.maxNotificationsPerDay));
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
      setWords((prev) => {
        const filtered = prev.filter((item) => item.id !== id);
        setWordsOffset(filtered.length);
        return filtered;
      });
      wordsCacheRef.current.forEach((entry, key) => {
        const filtered = entry.items.filter((item) => item.id !== id);
        wordsCacheRef.current.set(key, { ...entry, items: filtered, offset: filtered.length, loadedAt: Date.now() });
      });
      try {
        const freshStats = await api.getStats();
        setStats(freshStats);
        cacheTsRef.current.stats = Date.now();
      } catch {
        cacheTsRef.current.stats = 0;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deleteError'));
    } finally {
      setLoading(false);
    }
  };

  const adminCandidateId = me?.id ?? telegramUser?.id ?? (devUserId ? Number(devUserId) : null);
  const displayName = telegramUser
    ? `${telegramUser.first_name ?? ''} ${telegramUser.last_name ?? ''}`.trim() || telegramUser.username || t('userFallback')
    : adminCandidateId
      ? `${isAdmin ? t('adminLabel') : t('userIdLabel')} #${adminCandidateId}`
      : t('userFallback');
  const adminUsersTitle = adminQuery.trim()
    ? (lang === 'uz' ? 'Qidiruv natijalari' : 'Результаты поиска')
    : (lang === 'uz' ? 'Foydalanuvchilar' : 'Пользователи');

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
          <StatsSection
            t={t}
            lang={lang}
            stats={stats}
            referralCount={me?.referralCount ?? 0}
            onInvite={handleInvite}
          />
        )}

        {tab === 'words' && (
          <Suspense
            fallback={(
              <div key="words-fallback" className="section">
                <div className="panel" style={{ minHeight: '80vh' }}>
                  <div className="notice" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}>
                    {t('settingsLoading')}
                  </div>
                </div>
              </div>
            )}
          >
            <WordsSection
              t={t}
              lang={lang}
              stats={stats}
              loading={loading}
              query={query}
              setQuery={setQuery}
              words={words}
              wordsHasMore={wordsHasMore}
              wordsLoadingMore={wordsLoadingMore}
              onLoadMoreWords={() => { void loadMoreWords(); }}
              onDeleteWord={handleDelete}
              resolveWordStatus={resolveWordStatus}
              getWordStatusLabel={getWordStatusLabel}
            />
          </Suspense>
        )}

        {tab === 'settings' && (
          <Suspense
            fallback={(
              <div key="settings-fallback" className="section">
                <div className="panel">
                  <div className="notice" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}>
                    {t('settingsLoading')}
                  </div>
                </div>
              </div>
            )}
          >
            <SettingsSection
              t={t}
              lang={lang}
              form={form}
              loading={loading}
              intervalInput={intervalInput}
              limitInput={limitInput}
              quietStartValue={form ? minutesToTime(form.quietHoursStartMinutes) : ''}
              quietEndValue={form ? minutesToTime(form.quietHoursEndMinutes) : ''}
              onToggleNotifications={handleToggleNotifications}
              onIntervalInputChange={handleIntervalInputChange}
              onIntervalInputBlur={handleIntervalInputBlur}
              onLimitInputChange={handleLimitInputChange}
              onLimitInputBlur={handleLimitInputBlur}
              onQuietStartChange={handleQuietStartChange}
              onQuietEndChange={handleQuietEndChange}
              onSave={() => { void saveSettings(); }}
              onToggleLanguage={() => { void persistLanguage(lang === 'ru' ? 'uz' : 'ru'); }}
            />
          </Suspense>
        )}
        {tab === 'admin' && isAdmin && (
          <Suspense
            fallback={(
              <div key="admin-fallback" className="section section--admin">
                <div className="panel">
                  <div className="admin-state admin-state--loading">{t('adminOverviewLoading')}</div>
                </div>
              </div>
            )}
          >
            <AdminSection
              t={t}
              lang={lang}
              adminOverview={adminOverview}
              adminOverviewLoading={adminOverviewLoading}
              adminOverviewError={adminOverviewError}
              adminQuery={adminQuery}
              setAdminQuery={setAdminQuery}
              adminNotFound={adminNotFound}
              setAdminNotFound={setAdminNotFound}
              adminLookupError={adminLookupError}
              setAdminLookupError={setAdminLookupError}
              adminUsersError={adminUsersError}
              setAdminUsersError={setAdminUsersError}
              adminLookupLoading={adminLookupLoading}
              adminUsersLoading={adminUsersLoading}
              adminUsers={adminUsers}
              adminUsersHasMore={adminUsersHasMore}
              adminUser={adminUser}
              adminUsersTitle={adminUsersTitle}
              adminBroadcastMessage={adminBroadcastMessage}
              setAdminBroadcastMessage={setAdminBroadcastMessage}
              adminBroadcastPhoto={adminBroadcastPhoto}
              setAdminBroadcastPhoto={setAdminBroadcastPhoto}
              adminBroadcastLoading={adminBroadcastLoading}
              adminBroadcastNotice={adminBroadcastNotice}
              adminBroadcastError={adminBroadcastError}
              setAdminBroadcastError={setAdminBroadcastError}
              broadcastOverLimit={broadcastOverLimit}
              broadcastCounter={broadcastCounter}
              onRefreshOverview={() => { void loadAdminOverview(true); }}
              onLoadAdminUser={() => { void loadAdminUser(); }}
              onClearAdminSearch={clearAdminSearch}
              onOpenAdminUser={(id) => { void openAdminUser(id); }}
              onLoadMoreAdminUsers={() => { void loadMoreAdminUsers(); }}
              onSendAdminBroadcast={() => { void sendAdminBroadcast(); }}
              formatAdminCardPrimaryName={formatAdminCardPrimaryName}
              formatAdminName={formatAdminName}
              formatDateTime={formatDateTime}
              formatDateOnly={formatDateOnly}
            />
          </Suspense>
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

