import { BookOpen, Search, Trash2 } from 'lucide-react';
import { Stats, WordItem } from '../api';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;
type WordStatus = 'learned' | 'due' | 'new';

type WordsSectionProps = {
  t: TranslateFn;
  lang: 'ru' | 'uz';
  stats: Stats | null;
  loading: boolean;
  query: string;
  setQuery: (value: string) => void;
  words: WordItem[];
  wordsHasMore: boolean;
  wordsLoadingMore: boolean;
  onLoadMoreWords: () => void;
  onDeleteWord: (id: number) => void;
  resolveWordStatus: (word: WordItem) => WordStatus;
  getWordStatusLabel: (status: WordStatus) => string;
};

const WordsSection = ({
  t,
  lang,
  stats,
  loading,
  query,
  setQuery,
  words,
  wordsHasMore,
  wordsLoadingMore,
  onLoadMoreWords,
  onDeleteWord,
  resolveWordStatus,
  getWordStatusLabel,
}: WordsSectionProps) => {
  return (
    <div
      key="words"
      className="section"
    >
      <div className="panel" style={{ minHeight: '80vh' }}>
        <div className="words-head">
          <h2><Search size={20} /> {t('wordsTitle')}</h2>
          {stats && (
            <span className="words-total-chip">
              {lang === 'uz' ? 'Jami:' : 'Всего:'} {stats.wordsTotal}
            </span>
          )}
        </div>
        {stats && (
          <div className="words-meta words-meta--status">
            <span className="words-meta-item words-meta-item--new">
              {getWordStatusLabel('new')}: {Math.max(0, stats.wordsTotal - stats.learnedTotal - stats.dueNowTotal)}
            </span>
            <span className="words-meta-separator">|</span>
            <span className="words-meta-item words-meta-item--due">{t('dueNow')}: {stats.dueNowTotal}</span>
            <span className="words-meta-separator">|</span>
            <span className="words-meta-item words-meta-item--learned">{t('learned')}: {stats.learnedTotal}</span>
          </div>
        )}
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
                  <button className="btn-danger btn-danger-icon" onClick={() => onDeleteWord(word.id)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
          })}
          {wordsHasMore && (
            <button
              type="button"
              className="btn-ghost btn-compact"
              style={{ marginTop: 10, width: '100%' }}
              disabled={wordsLoadingMore || loading}
              onClick={onLoadMoreWords}
            >
              {wordsLoadingMore
                ? (lang === 'uz' ? 'Yuklanmoqda...' : 'Загрузка...')
                : (lang === 'uz' ? "Yana ko'rsatish" : 'Показать ещё')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default WordsSection;
