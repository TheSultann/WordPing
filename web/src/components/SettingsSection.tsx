import { Bell, Clock, Languages, Save } from 'lucide-react';
import { Settings } from '../api';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type SettingsSectionProps = {
  t: TranslateFn;
  lang: 'ru' | 'uz';
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
  return (
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
    </div>
  );
};

export default SettingsSection;
