import { Flame, Rocket, Sparkles, Trophy, Zap } from 'lucide-react';
import type { GameResult as GameResultType } from '../../types/game';

type GameResultProps = {
  result: GameResultType;
  badge: string;
  headline: string;
  subtitle: string;
  failedWordTitle: string;
  distanceLabel: string;
  wordsLabel: string;
  comboLabel: string;
  distanceUnit: string;
  playAgainLabel: string;
  backLabel: string;
  onPlayAgain: () => void;
  onBackToMenu: () => void;
};

const GameResult = ({
  result,
  badge,
  headline,
  subtitle,
  failedWordTitle,
  distanceLabel,
  wordsLabel,
  comboLabel,
  distanceUnit,
  playAgainLabel,
  backLabel,
  onPlayAgain,
  onBackToMenu,
}: GameResultProps) => {
  const resultTone = result.wordsDestroyed === 0
    ? 'retry'
    : result.wordsDestroyed <= 3
      ? 'rocket'
      : 'trophy';

  const resultSymbol = result.wordsDestroyed === 0
    ? <Flame size={34} strokeWidth={2.2} />
    : result.wordsDestroyed <= 3
      ? <Rocket size={34} strokeWidth={2.2} />
      : <Trophy size={34} strokeWidth={2.2} />;

  return (
    <div className="game-result">
      <div className="game-result__badge">{badge}</div>
      <div className={`game-result__symbol game-result__symbol--${resultTone}`} aria-hidden="true">
        {resultSymbol}
      </div>
      <h2 className="game-result__headline">
        {headline}
      </h2>
      <p className="game-result__subtitle">{subtitle}</p>

      <div className="game-result__score">
        <strong className="game-result__score-value">
          {result.score} {distanceUnit}
        </strong>
        <span className="game-result__score-caption">{distanceLabel}</span>
      </div>

      <div className="game-result__stats">
        <div className="game-result__stat game-result__stat--words">
          <div className="game-result__stat-top">
            <Sparkles className="game-result__stat-icon" aria-hidden="true" />
            <span className="game-result__stat-name">{wordsLabel}</span>
          </div>
          <strong>{result.wordsDestroyed}</strong>
        </div>
        <div className="game-result__stat game-result__stat--combo">
          <div className="game-result__stat-top">
            <Zap className="game-result__stat-icon" aria-hidden="true" />
            <span className="game-result__stat-name">{comboLabel}</span>
          </div>
          <strong>x{result.bestCombo}</strong>
        </div>
      </div>

      {result.failedWord ? (
        <div className="game-result__failed-word">
          <p className="game-result__failed-title">{failedWordTitle}</p>
          <strong className="game-result__failed-answer">
            {result.failedWord.answerText.toUpperCase()}
          </strong>
          <p className="game-result__failed-translation">{result.failedWord.promptText}</p>
        </div>
      ) : (
        <div className="game-result__failed-word game-result__failed-word--empty">
          <p className="game-result__failed-title">{failedWordTitle}</p>
        </div>
      )}

      <div className="game-result__actions">
        <button type="button" className="btn-primary game-result__play-again" onClick={onPlayAgain}>
          {playAgainLabel}
        </button>
        <button type="button" className="btn-ghost btn-compact game-result__back" onClick={onBackToMenu}>
          {backLabel}
        </button>
      </div>
    </div>
  );
};

export default GameResult;
