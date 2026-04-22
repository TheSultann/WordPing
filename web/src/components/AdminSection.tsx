import { Book, Bell, RotateCcw, Search, Shield, UserPlus, Users, Zap } from 'lucide-react';
import type { AdminBlockedUserSummary, AdminOverview, AdminUserSummary } from '../api';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type AdminSectionProps = {
  t: TranslateFn;
  lang: 'ru' | 'uz';
  adminOverview: AdminOverview | null;
  adminOverviewLoading: boolean;
  adminOverviewError: string;
  adminBlockedUsers: AdminBlockedUserSummary[];
  adminBlockedUsersCount: number;
  adminQuery: string;
  setAdminQuery: (value: string) => void;
  adminNotFound: boolean;
  setAdminNotFound: (value: boolean) => void;
  adminLookupError: string;
  setAdminLookupError: (value: string) => void;
  adminUsersError: string;
  setAdminUsersError: (value: string) => void;
  adminLookupLoading: boolean;
  adminUsersLoading: boolean;
  adminUsers: AdminUserSummary[];
  adminUsersHasMore: boolean;
  adminUser: AdminUserSummary | null;
  adminUsersTitle: string;
  adminBroadcastMessage: string;
  setAdminBroadcastMessage: (value: string) => void;
  adminBroadcastPhoto: string;
  setAdminBroadcastPhoto: (value: string) => void;
  adminBroadcastLoading: boolean;
  adminBroadcastNotice: string;
  adminBroadcastError: string;
  setAdminBroadcastError: (value: string) => void;
  broadcastOverLimit: boolean;
  broadcastCounter: string;
  onRefreshOverview: () => void;
  onLoadAdminUser: () => void;
  onClearAdminSearch: () => void;
  onOpenAdminUser: (id: string) => void;
  onLoadMoreAdminUsers: () => void;
  onSendAdminBroadcast: () => void;
  formatAdminCardPrimaryName: (user: AdminUserSummary) => string;
  formatAdminName: (user: AdminUserSummary) => string;
  formatBlockedName: (user: AdminBlockedUserSummary) => string;
  formatDateTime: (value?: string | null) => string;
  formatDateOnly: (value?: string | null) => string;
};

const AdminSection = ({
  t,
  lang,
  adminOverview,
  adminOverviewLoading,
  adminOverviewError,
  adminBlockedUsers,
  adminBlockedUsersCount,
  adminQuery,
  setAdminQuery,
  adminNotFound,
  setAdminNotFound,
  adminLookupError,
  setAdminLookupError,
  adminUsersError,
  setAdminUsersError,
  adminLookupLoading,
  adminUsersLoading,
  adminUsers,
  adminUsersHasMore,
  adminUser,
  adminUsersTitle,
  adminBroadcastMessage,
  setAdminBroadcastMessage,
  adminBroadcastPhoto,
  setAdminBroadcastPhoto,
  adminBroadcastLoading,
  adminBroadcastNotice,
  adminBroadcastError,
  setAdminBroadcastError,
  broadcastOverLimit,
  broadcastCounter,
  onRefreshOverview,
  onLoadAdminUser,
  onClearAdminSearch,
  onOpenAdminUser,
  onLoadMoreAdminUsers,
  onSendAdminBroadcast,
  formatAdminCardPrimaryName,
  formatAdminName,
  formatBlockedName,
  formatDateTime,
  formatDateOnly,
}: AdminSectionProps) => {
  return (
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
              onClick={onRefreshOverview}
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
              <div className="admin-metric admin-metric--blocked admin-metric--blocked-card">
                <div className="admin-metric-icon"><Shield size={18} strokeWidth={2.2} /></div>
                <span>{t('adminBlockedTitle')}</span>
                <strong>{adminBlockedUsersCount}</strong>
                <div className="admin-metric-details">
                  {adminOverviewError ? (
                    <div className="admin-state admin-state--error">{adminOverviewError}</div>
                  ) : adminOverviewLoading && !adminOverview ? (
                    <div className="admin-state admin-state--loading">{t('adminOverviewLoading')}</div>
                  ) : adminBlockedUsers.length > 0 ? (
                    <div className="admin-recent-list-clean">
                      {adminBlockedUsers.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="admin-recent-row-clean"
                          onClick={() => {
                            setAdminQuery(item.id);
                            onOpenAdminUser(item.id);
                          }}
                        >
                          <div className="admin-recent-col">
                            <span>Name</span>
                            <strong>{formatBlockedName(item)}</strong>
                          </div>
                          <div className="admin-recent-col">
                            <span>@</span>
                            <strong>{item.tgUsername ? `@${item.tgUsername}` : '-'}</strong>
                          </div>
                          <div className="admin-recent-col admin-recent-col--id">
                            <span>{t('adminFieldId')}</span>
                            <strong>{item.id}</strong>
                          </div>
                          <div className="admin-recent-col admin-recent-col--date">
                            <span>{t('adminFieldBlockedAt')}</span>
                            <strong>{formatDateTime(item.blockedAt)}</strong>
                          </div>
                          <div className="admin-recent-col">
                            <span>{t('adminFieldWords')}</span>
                            <strong>{item.wordsCount}</strong>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="admin-state">{t('adminBlockedEmpty')}</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={`admin-state ${adminOverviewError ? 'admin-state--error' : 'admin-state--loading'}`}>
              {adminOverviewError ? adminOverviewError : t('adminOverviewLoading')}
            </div>
          )}
        </div>

        <div className="admin-main-grid">
          <div className="panel admin-block admin-block--lookup">
            <h2><Search size={18} /> {t('adminLookupTitle')}</h2>
            <div className="admin-search">
              <input
                type="text"
                placeholder="ID / @username / name"
                value={adminQuery}
                onChange={(e) => {
                  setAdminQuery(e.target.value);
                  if (adminNotFound) setAdminNotFound(false);
                  if (adminLookupError) setAdminLookupError('');
                  if (adminUsersError) setAdminUsersError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onLoadAdminUser();
                  }
                }}
              />
              <div className="admin-search-actions">
                <button
                  type="button"
                  className="btn-primary btn-compact"
                  onClick={onLoadAdminUser}
                  disabled={adminLookupLoading || !adminQuery.trim()}
                >
                  {adminLookupLoading ? t('adminLookupLoading') : t('adminSearchAction')}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={onClearAdminSearch}
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
            {adminUsersError && (
              <div className="admin-state admin-state--error">{adminUsersError || t('adminLookupError')}</div>
            )}
            {adminNotFound && (
              <div className="admin-state admin-state--error">{t('adminNotFound')}</div>
            )}

            {adminUser && (
              <div className="admin-user-card admin-user-card--clean">
                <div className="admin-user-header">
                  <div className="admin-user-left">
                    <div className="admin-user-label">{t('adminUserDetails')}</div>
                    {formatAdminCardPrimaryName(adminUser) && (
                      <div className="admin-user-label" style={{ fontSize: 18, color: 'var(--text-main)' }}>
                        {formatAdminCardPrimaryName(adminUser)}
                      </div>
                    )}
                    {adminUser.tgUsername && (
                      <div className="admin-user-label" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>
                        @{adminUser.tgUsername}
                      </div>
                    )}
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

            <div style={{ marginTop: 14 }}>
              <div className="admin-user-label">{adminUsersTitle}</div>
              {adminUsersLoading ? (
                <div className="admin-state admin-state--loading">{t('adminLookupLoading')}</div>
              ) : adminUsers.length > 0 ? (
                <>
                  <div className="admin-recent-list-clean">
                    {adminUsers.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="admin-recent-row-clean"
                        onClick={() => {
                          setAdminQuery(item.id);
                          onOpenAdminUser(item.id);
                        }}
                      >
                        <div className="admin-recent-col">
                          <span>Name</span>
                          <strong>{formatAdminName(item)}</strong>
                        </div>
                        <div className="admin-recent-col">
                          <span>@</span>
                          <strong>{item.tgUsername ? `@${item.tgUsername}` : '-'}</strong>
                        </div>
                        <div className="admin-recent-col admin-recent-col--id">
                          <span>{t('adminFieldId')}</span>
                          <strong>{item.id}</strong>
                        </div>
                        <div className="admin-recent-col admin-recent-col--date">
                          <span>{t('adminFieldCreated')}</span>
                          <strong>{formatDateOnly(item.createdAt)}</strong>
                        </div>
                      </button>
                    ))}
                  </div>
                  {adminUsersHasMore && (
                    <button
                      type="button"
                      className="btn-ghost btn-compact"
                      style={{ marginTop: 10, width: '100%' }}
                      disabled={adminUsersLoading}
                      onClick={onLoadMoreAdminUsers}
                    >
                      {lang === 'uz' ? "Yana ko'rsatish" : 'Показать ещё'}
                    </button>
                  )}
                </>
              ) : (
                <div className="admin-state admin-state--loading">{t('adminRecentEmpty')}</div>
              )}
            </div>
          </div>

          <div className="panel admin-block admin-block--broadcast">
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
                onClick={onSendAdminBroadcast}
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
  );
};

export default AdminSection;
