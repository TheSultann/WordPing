import { useEffect, useState } from 'react';
import { Bell, CircleHelp, Clock, Languages, Save, X } from 'lucide-react';
import type { Settings } from '../api';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type SettingsSectionProps = {
  t: TranslateFn;
  lang: 'ru' | 'uz';
  flowOpenRequest?: number;
  form: Settings | null;
  loading: boolean;
  intervalInput: string;
  limitInput: string;
  quietStartValue: string;
  quietEndValue: string;
  onToggleNotifications: (checked: boolean) => void;
  onIntervalInputChange: (value: string) => void;
  onIntervalInputBlur: () => void;
  onLimitInputChange: (value: string) => void;
  onLimitInputBlur: () => void;
  onQuietStartChange: (value: string) => void;
  onQuietEndChange: (value: string) => void;
  onSave: () => void;
  onToggleLanguage: () => void;
};

const SettingsSection = ({
  t,
  lang,
  flowOpenRequest = 0,
  form,
  loading,
  intervalInput,
  limitInput,
  quietStartValue,
  quietEndValue,
  onToggleNotifications,
  onIntervalInputChange,
  onIntervalInputBlur,
  onLimitInputChange,
  onLimitInputBlur,
  onQuietStartChange,
  onQuietEndChange,
  onSave,
  onToggleLanguage,
}: SettingsSectionProps) => {
  const [isFlowOpen, setIsFlowOpen] = useState(() => flowOpenRequest > 0);

  useEffect(() => {
    if (!isFlowOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFlowOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFlowOpen]);

  return (
    <div
      key="settings"
      className="section"
    >
      <div className="panel">
        <div className="settings-panel-head">
          <h2><Bell size={20} className="text-primary" /> {t('settingsTitle')}</h2>
          <button
            type="button"
            className="settings-info-btn"
            aria-label={t('settingsInfoAria')}
            onClick={() => setIsFlowOpen(true)}
          >
            <CircleHelp size={16} />
          </button>
        </div>
        {form ? (
          <div className="grid">
            <div className="checkbox-field">
              <label>{t('notifyToggle')}</label>
              <label className="checkbox-wrapper">
                <input
                  type="checkbox"
                  checked={form.notificationsEnabled}
                  onChange={(e) => onToggleNotifications(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="field">
              <label>{t('intervalLabel')}</label>
              <input
                type="text"
                inputMode="numeric"
                min={5}
                max={240}
                value={intervalInput}
                onChange={(e) => onIntervalInputChange(e.target.value)}
                onBlur={onIntervalInputBlur}
              />
            </div>

            <div className="field">
              <label>{t('limitLabel')}</label>
              <input
                type="text"
                inputMode="numeric"
                min={5}
                max={40}
                value={limitInput}
                onChange={(e) => onLimitInputChange(e.target.value)}
                onBlur={onLimitInputBlur}
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
                value={quietStartValue}
                onChange={(e) => onQuietStartChange(e.target.value)}
              />
            </div>
            <div className="field">
              <label>{t('quietEnd')}</label>
              <input
                type="time"
                value={quietEndValue}
                onChange={(e) => onQuietEndChange(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="notice" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}>{t('settingsLoading')}</div>
        )}
      </div>

      <div className="actions settings-actions">
        <button className="btn-primary" onClick={onSave} disabled={loading}>
          <Save size={18} /> {t('save')}
        </button>
      </div>
      <div className="actions settings-actions settings-actions--secondary">
        <button
          type="button"
          className="chip-btn settings-lang-btn"
          onClick={onToggleLanguage}
        >
          <Languages size={16} />
          <span>{lang === 'ru' ? t('languageRu') : t('languageUz')}</span>
        </button>
      </div>

      {isFlowOpen ? (
        <div
          className="sheet-overlay"
          role="presentation"
          onClick={() => setIsFlowOpen(false)}
        >
          <div
            className="sheet-card sheet-card--info"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-flow-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-head">
              <h3 id="settings-flow-title">{t('settingsFlowTitle')}</h3>
              <button
                type="button"
                className="sheet-close-btn"
                aria-label={t('settingsFlowClose')}
                onClick={() => setIsFlowOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="sheet-body">
            <p className="sheet-intro">{t('settingsFlowIntro')}</p>
            <div className="sheet-timeline" aria-label={t('settingsFlowTimelineTitle')}>
              <div className="sheet-timeline__item">
                <span className="sheet-timeline__circle">S0</span>
                <div className="sheet-timeline__card">
                  <p className="sheet-timeline__title">{lang === 'uz' ? "Yangi so‘z qo‘shildi" : 'Новое слово добавлено'}</p>
                  <p className="sheet-timeline__sub">{lang === 'uz' ? 'Birinchi eslatma → 5 daqiqadan so‘ng' : 'Первое напоминание → 5 мин'}</p>
                </div>
              </div>
              <div className="sheet-timeline__item">
                <span className="sheet-timeline__circle">S1</span>
                <div className="sheet-timeline__card">
                  <p className="sheet-timeline__title">{lang === 'uz' ? '1-bosqich' : 'Stage 1'}</p>
                  <p className="sheet-timeline__sub">{lang === 'uz' ? 'Keyingi eslatma → 25 daqiqadan so‘ng' : 'Следующее → 25 мин'}</p>
                </div>
              </div>
              <div className="sheet-timeline__item">
                <span className="sheet-timeline__circle">S2</span>
                <div className="sheet-timeline__card">
                  <p className="sheet-timeline__title">{lang === 'uz' ? '2-bosqich' : 'Stage 2'}</p>
                  <p className="sheet-timeline__sub">{lang === 'uz' ? 'Keyingi eslatma → 1,5 soatdan so‘ng' : 'Следующее → 1.5 часа'}</p>
                </div>
              </div>
              <div className="sheet-timeline__item">
                <span className="sheet-timeline__circle">S3</span>
                <div className="sheet-timeline__card">
                  <p className="sheet-timeline__title">{lang === 'uz' ? '3-bosqich' : 'Stage 3'}</p>
                  <p className="sheet-timeline__sub">{lang === 'uz' ? 'Keyingi eslatma → 20 soatdan so‘ng' : 'Следующее → 20 часов'}</p>
                </div>
              </div>
              <div className="sheet-timeline__item">
                <span className="sheet-timeline__circle">...</span>
                <div className="sheet-timeline__card">
                  <p className="sheet-timeline__title">{t('settingsFlowTimelineLater')}</p>
                </div>
              </div>
            </div>
            <div className="sheet-outro">
              <div className="sheet-outro__row">
                <span>👍 <strong>GOOD</strong></span>
                <span>{lang === 'uz' ? '+1 bosqich oshadi' : 'при нажатии stage +1'}</span>
              </div>
              <div className="sheet-outro__row">
                <span>✅ <strong>EASY</strong></span>
                <span>{lang === 'uz' ? '+2 bosqich oshadi' : 'при нажатии stage +2'}</span>
              </div>
              <div className="sheet-outro__row">
                <span>❌ <strong>HARD</strong></span>
                <span>{lang === 'uz' ? '-1 bosqich kamayadi' : 'при нажатии stage −1'}</span>
              </div>
            </div>
            <div className="sheet-steps">
              <div className="sheet-step">
                <span className="sheet-step__badge sheet-step__badge--new">{lang === 'uz' ? 'Yangi' : 'New'}</span>
                <p>{t('settingsFlowStepNew')}</p>
              </div>
              <div className="sheet-step">
                <span className="sheet-step__badge sheet-step__badge--quiz">Quiz</span>
                <p>{t('settingsFlowStepQuiz')}</p>
              </div>
              <div className="sheet-step">
                <span className="sheet-step__badge sheet-step__badge--news">News</span>
                <p>{t('settingsFlowStepNews')}</p>
              </div>
            </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SettingsSection;
