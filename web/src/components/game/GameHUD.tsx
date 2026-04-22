import { Heart, Rocket } from 'lucide-react';

type GameHUDProps = {
  score: number;
  distanceLabel: string;
  distanceUnit: string;
  livesRemaining: number;
  maxLives: number;
};

const GameHUD = ({ score, distanceLabel, distanceUnit, livesRemaining, maxLives }: GameHUDProps) => {
  const lifeSlots = Array.from({ length: maxLives }, (_, index) => index < livesRemaining);

  return (
    <div className="rocket-hud">
      <div className="rocket-hud__main">
        <span className="rocket-hud__icon" aria-hidden="true">
          <Rocket size={18} strokeWidth={2.25} />
        </span>

        <div className="rocket-hud__copy">
          <span className="rocket-hud__label">{distanceLabel}</span>
          <strong className="rocket-hud__value">
            {score}
            <small>{distanceUnit}</small>
          </strong>
        </div>
      </div>

      <div className="rocket-hud__lives" aria-label={`${livesRemaining}/${maxLives} lives`}>
        {lifeSlots.map((isActive, index) => (
          <span
            key={index}
            className={`rocket-hud__life ${isActive ? 'is-active' : ''}`}
            aria-hidden="true"
          >
            <Heart size={16} strokeWidth={2.1} fill={isActive ? 'currentColor' : 'transparent'} />
          </span>
        ))}
      </div>
    </div>
  );
};

export default GameHUD;
