import { useEffect, useMemo, useState } from 'react';
import { api, Settings, Stats, WordItem, Me } from './api';
import { 
  Settings as SettingsIcon, 
  BarChart3, 
  Book, 
  Save, 
  RotateCcw, 
  Trash2, 
  Flame,
  UserPlus,
  Copy,
  Sun,
  Moon,
  Languages,
  Zap, 
  Clock, 
  Bell, 
  Target,
  Search,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
    doneToday: 'Сделано сегодня',
    dictionary: 'Словарь',
    dueToday: 'На повтор',
    level: 'Уровень',
    levelPro: 'Pro',
    levelNovice: 'Новичок',
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
    tabHome: 'Главная',
    tabDictionary: 'Словарь',
    tabSettings: 'Настройки',
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
    level: 'Daraja',
    levelPro: 'Pro',
    levelNovice: "Boshlang'ich",
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
    tabHome: 'Asosiy',
    tabDictionary: "Lug'at",
    tabSettings: 'Sozlamalar',
  },
} as const;

type Lang = keyof typeof COPY;
type CopyKey = keyof (typeof COPY)['ru'];
type Theme = 'light' | 'dark';

const LANG_STORAGE_KEY = 'wordping.lang';
const THEME_STORAGE_KEY = 'wordping.theme';

const getStoredLang = (): Lang | null => {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(LANG_STORAGE_KEY);
  return value === 'uz' || value === 'ru' ? value : null;
};

const getStoredTheme = (): Theme | null => {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === 'dark' || value === 'light' ? value : null;
};

const App = () => {
  const [tab, setTab] = useState<'settings' | 'stats' | 'words'>('stats');
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
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme() ?? 'dark');

  const telegramUser = useMemo(() => getTelegramUser(), []);
  const hasInitData = Boolean((window as any)?.Telegram?.WebApp?.initData);
  const devUserId = new URLSearchParams(window.location.search).get('devUserId');
  const canAuth = hasInitData || Boolean(devUserId);

  const t = (key: CopyKey) => COPY[lang]?.[key] ?? COPY.ru[key];

  const loadMe = async () => {
    try {
      const data = await api.getMe();
      setMe(data);
      const value = data.language === 'uz' ? 'uz' : 'ru';
      setLangOverride(value);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveLanguageError'));
    }
  };

  const setThemePreference = (value: Theme) => {
    setTheme(value);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, value);
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
        .catch(() => {});
      return;
    }
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyInvite = async () => {
    const link = buildReferralLink();
    if (!link) {
      setError(t('inviteMissingBot'));
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setNotice(t('inviteCopied'));
      setTimeout(() => setNotice(''), 2000);
    } catch {
      setError(t('inviteCopyFailed'));
    }
  };

  useEffect(() => {
    const tg = (window as any)?.Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    const tg = (window as any)?.Telegram?.WebApp;
    if (tg) {
      const bg = theme === 'dark' ? '#0b0f14' : '#F4F1EC';
      tg.setHeaderColor?.(bg);
      tg.setBackgroundColor?.(bg);
    }
  }, [theme]);

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
    if (tab === 'settings') {
      void loadSettings();
    }
    if (tab === 'stats') {
      void loadStats();
    }
    if (tab === 'words') {
      void loadWords(query);
    }
  }, [tab, canAuth]);

  useEffect(() => {
    if (tab !== 'words' || !canAuth) return;
    const handle = setTimeout(() => {
      void loadWords(query);
    }, 300);
    return () => clearTimeout(handle);
  }, [query, tab, canAuth]);

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.getSettings();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadSettingsError'));
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.getStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadStatsError'));
    } finally {
      setLoading(false);
    }
  };

  const loadWords = async (q?: string) => {
    try {
      setLoading(true);
      setError('');
      const data = await api.getWords(q);
      setWords(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadWordsError'));
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!form) return;
    try {
      setLoading(true);
      setError('');
      const data = await api.updateSettings(form);
      setSettings(data);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deleteError'));
    } finally {
      setLoading(false);
    }
  };

  const displayName = telegramUser
    ? `${telegramUser.first_name ?? ''} ${telegramUser.last_name ?? ''}`.trim() || telegramUser.username || t('userFallback')
    : t('userFallback');

  return (

    <div className="app">
        <div className="header">
          <div className="brand">
            <div className="brand-icon">
              <Zap size={24} />
            </div>
            <div className="brand-text">
              <h1>WordPing</h1>
              <p>{t('tagline')}</p>
            </div>
          </div>
          <div className="user-pill">{displayName}</div>
        </div>

      <AnimatePresence mode='wait'>
        {tab === 'stats' && (
          <motion.div 
            key="stats"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="section"
          >
            {stats ? (
              <>
                <div className="panel hero-panel">
                  <div className="streak-hero">
                    <div className="streak-main">
                      <span className="streak-flame">
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
                      <div className="stat-card">
                        <div className="stat-emoji">🎯</div>
                        <span>{t('doneToday')}</span>
                        <strong>{stats.doneTodayCount} / {stats.dailyLimit}</strong>
                      </div>
                      <div className="stat-card">
                        <div className="stat-emoji">📚</div>
                        <span>{t('dictionary')}</span>
                        <strong>{stats.words}</strong>
                      </div>
                      <div className="stat-card">
                        <div className="stat-emoji">⏳</div>
                        <span>{t('dueToday')}</span>
                        <strong>{stats.dueToday}</strong>
                      </div>
                      <div className="stat-card">
                        <div className="stat-emoji">⭐️</div>
                        <span>{t('level')}</span>
                        <strong>{stats.words > 100 ? t('levelPro') : t('levelNovice')}</strong>
                      </div>
                  </div>
                </div>

                <div className="panel invite-panel">
                  <div className="invite-head">
                    <h2><UserPlus size={20} className="text-primary" /> {t('inviteTitle')}</h2>
                    <div className="invite-count">
                      <span>{t('inviteCountLabel')}</span>
                      <strong>{me?.referralCount ?? 0}</strong>
                    </div>
                  </div>
                  <p className="invite-text">{t('inviteDesc')}</p>
                  <div className="invite-actions">
                    <button className="btn-primary" onClick={handleInvite}>
                      <UserPlus size={18} /> {t('inviteButton')}
                    </button>
                    <button className="btn-secondary" onClick={handleCopyInvite}>
                      <Copy size={18} /> {t('inviteCopy')}
                    </button>
                  </div>
                  {BOT_USERNAME && (
                    <div className="invite-link invite-link--click" onClick={handleCopyInvite} role="button" tabIndex={0} onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void handleCopyInvite();
                      }
                    }}>
                      <span>{t('inviteLinkLabel')}</span>
                      <code>{buildReferralLink()}</code>
                    </div>
                  )}
                </div>
              </>
            ) : (
               <div className="notice" style={{background: 'transparent', border:'none', color: 'var(--text-muted)'}}>
                  {t('statsLoading')}
               </div>
            )}
          </motion.div>
        )}

        {tab === 'words' && (
          <motion.div 
             key="words"
             initial={{ opacity: 0, scale: 0.98 }}
             animate={{ opacity: 1, scale: 1 }}
             exit={{ opacity: 0, scale: 0.98 }}
             transition={{ duration: 0.2 }}
            className="section"
          >
            <div className="panel" style={{minHeight: '80vh'}}>
              <h2><Search size={20} /> {t('wordsTitle')}</h2>
              <div className="field word-search">
                <input
                  type="text"
                  placeholder={t('wordsSearch')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="word-list" style={{marginTop: 16}}>
                {words.length === 0 && !loading && (
                   <div style={{textAlign: 'center', padding: 40, color: 'var(--text-muted)'}}>
                      <div style={{fontSize: 40, marginBottom: 10}}>📭</div>
                      {t('wordsEmpty')}
                   </div>
                )}
                {words.map((word) => (
                  <div key={word.id} className="word-item">
                    <div className="word-main">
                      <strong>{word.wordEn}</strong>
                      <small>{word.translationRu}</small>
                    </div>
                    <button className="delete-btn" onClick={() => handleDelete(word.id)}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {tab === 'settings' && (
          <motion.div 
            key="settings"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="section"
          >
            <div className="inline-controls">
              <button
                type="button"
                className="chip-btn"
                onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                <span>{theme === 'dark' ? t('themeDark') : t('themeLight')}</span>
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => persistLanguage(lang === 'ru' ? 'uz' : 'ru')}
              >
                <Languages size={16} />
                <span>{lang === 'ru' ? t('languageRu') : t('languageUz')}</span>
              </button>
            </div>

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
                <div className="notice" style={{background: 'transparent', border:'none', color: 'var(--text-muted)'}}>{t('settingsLoading')}</div>
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
                <div className="notice" style={{background: 'transparent', border:'none', color: 'var(--text-muted)'}}>{t('settingsLoading')}</div>
              )}
            </div>

            <div className="actions">
              <button className="btn-primary" onClick={saveSettings} disabled={loading}>
                <Save size={18} /> {t('save')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {notice && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="notice">
          <CheckCircle2 size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
          {notice}
        </motion.div>
      )}
      {error && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="notice" style={{ color: '#ef4444', borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)' }}>
          <AlertCircle size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
          {error}
        </motion.div>
      )}

      <div className="tabs-container">
        <button className={`tab-btn ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
          <Book size={20} /> {/* Used Book icon as 'Home' feel for studying */}
          <span>{t('tabHome')}</span>
        </button>
        <button className={`tab-btn ${tab === 'words' ? 'active' : ''}`} onClick={() => setTab('words')}>
          <Search size={20} />
          <span>{t('tabDictionary')}</span>
        </button>
        <button className={`tab-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          <SettingsIcon size={20} />
          <span>{t('tabSettings')}</span>
        </button>
      </div>
    </div>
  );
};

export default App;
