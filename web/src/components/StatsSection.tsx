import { Bell, CheckCircle2, Flame, Hourglass, Target, TrendingUp, UserPlus } from 'lucide-react';
import type { Stats } from '../api';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type StatsSectionProps = {
  t: TranslateFn;
  lang: 'ru' | 'uz';
  stats: Stats | null;
  referralCount: number;
  onInvite: () => void;
};

const StatsSection = ({ t, lang, stats, referralCount, onInvite }: StatsSectionProps) => {
  return (
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
            <h2 className="stats-section-title">
              <span className="stats-section-title__icon" aria-hidden="true">
                <TrendingUp size={16} strokeWidth={2.4} />
              </span>
              {lang === 'uz' ? 'Bugungi statistika' : 'Прогресс за сегодня'}
            </h2>
            <div className="stat-grid">
              <div className="stat-card stat-card--due">
                <div className="stat-emoji stat-emoji--due"><Hourglass size={18} strokeWidth={2.2} /></div>
                <span>{t('waitingToday')}</span>
                <strong>{stats.dueTodayCount}</strong>
              </div>
              <div className="stat-card stat-card--today">
                <div className="stat-emoji stat-emoji--today"><CheckCircle2 size={18} strokeWidth={2.2} /></div>
                <span>{t('answeredToday')}</span>
                <strong>{stats.doneTodayCount}</strong>
              </div>
              <div className="stat-card stat-card--accuracy">
                <div className="stat-emoji stat-emoji--accuracy"><Target size={18} strokeWidth={2.2} /></div>
                <span>{t('accuracyToday')}</span>
                <strong>{stats.accuracyTodayPercent}%</strong>
              </div>
              <div className="stat-card stat-card--notifications">
                <div className="stat-emoji stat-emoji--notifications"><Bell size={18} strokeWidth={2.2} /></div>
                <span>{t('notifications')}</span>
                <strong>{stats.notificationsSentToday} / {stats.dailyLimit}</strong>
              </div>
            </div>
          </div>

          <div className="invite-row">
            <button className="invite-cta invite-cta--full" onClick={onInvite}>
              <span className="invite-cta-main">
                <UserPlus size={18} />
                <span>{t('inviteButton')}</span>
              </span>
              <span className="invite-cta-badge">{referralCount}</span>
            </button>
          </div>
        </>
      ) : (
        <div className="notice" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}>
          {t('statsLoading')}
        </div>
      )}
    </div>
  );
};

export default StatsSection;
