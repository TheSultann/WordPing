export type GameStatus = 'idle' | 'loading' | 'countdown' | 'playing' | 'exiting' | 'impact' | 'paused' | 'finished';

export type GameWord = {
  id: string;
  promptText: string;
  promptLanguage: 'ru' | 'uz';
  answerLanguage: 'en';
  primaryAnswer: string;
  acceptedAnswers: string[];
  stage: number;
};

export type WordCard = {
  word: GameWord;
  y: number;
  startOffsetY: number;
  timeoutMs: number;
  createdAt: number;
  collisionAt: number;
  comboMultiplier: number;
};

export type RocketPhase = 'hidden' | 'active' | 'impact';

export type RocketVisual = {
  phase: RocketPhase;
  y: number;
  opacity: number;
  impactProgress: number;
};

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  color: string;
};

export type GameState = {
  status: GameStatus;
  score: number;
  wordsDestroyed: number;
  currentCard: WordCard | null;
  particles: Particle[];
  livesRemaining: number;
};

export type GameResult = {
  score: number;
  wordsDestroyed: number;
  bestCombo: number;
  failedWord?: {
    promptText: string;
    answerText: string;
    promptLanguage: 'ru' | 'uz';
    answerLanguage: 'en';
  } | null;
};
