import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, RefreshCcw, Rocket } from 'lucide-react';
import { api, type WordItem } from '../api';
import GameCanvas, { getGameCanvasLayout } from '../components/game/GameCanvas';
import GameHUD from '../components/game/GameHUD';
import GameResult from '../components/game/GameResult';
import SpeechIndicator from '../components/game/SpeechIndicator';
import useGameLoop from '../hooks/useGameLoop';
import useSpeechRecognition, { type SpeechErrorCode } from '../hooks/useSpeechRecognition';
import type {
  GameResult as GameResultType,
  GameState,
  GameStatus,
  GameWord,
  Particle,
  RocketVisual,
  WordCard,
} from '../types/game';
import { isMatch, normalizeEnglishAnswer } from '../utils/levenshtein';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type RocketGameProps = {
  onBackToMenu: () => void;
  lang: 'ru' | 'uz';
  t: TranslateFn;
};

type CanvasScene = {
  status: GameStatus;
  currentCard: WordCard | null;
  particles: Particle[];
  timeLeftProgress: number;
  cardFadeProgress: number;
  rocket: RocketVisual;
  launchStartedAt: number | null;
};

type ViewportMetrics = {
  width: number;
  height: number;
  keyboardInset: number;
};

type OverlayHeights = {
  hud: number;
  speech: number;
};

type LayoutMetrics = {
  width: number;
  height: number;
  sideInset: number;
  topInset: number;
  compactGap: number;
  blockGap: number;
  topButtonHeight: number;
  topButtonRadius: number;
  topButtonPaddingX: number;
  topIconSize: number;
  topButtonFontSize: number;
  panelPaddingX: number;
  panelPaddingY: number;
  panelRadius: number;
  panelMaxWidth: number;
  heroIconSize: number;
  startTopPadding: number;
  startBottomPadding: number;
  hudHeight: number;
  hudTopOffset: number;
  speechPanelHeight: number;
  speechBottomGap: number;
  sceneTopGap: number;
  sceneBottomGap: number;
};

type GamePageStyle = CSSProperties & Record<string, string | number>;

const MIN_WORDS = 5;
const WORD_LIMIT = 100;
const INITIAL_LIVES = 2;
const BASE_SCORE_PER_WORD = 100;
const MAX_SCORE_PER_WORD = 500;
const FRAME_MS = 1000 / 60;
const PARTICLE_LIFETIME_MS = 400;
const IMPACT_DURATION_MS = 460;
const SUCCESS_EXIT_DURATION_MS = 620;
const MIN_CARD_TIMEOUT_MS = 6000;
const MAX_CARD_TIMEOUT_MS = 8500;
const COUNTDOWN_STEP_MS = 700;
const COUNTDOWN_STEPS = 3;
const COUNTDOWN_TOTAL_MS = COUNTDOWN_STEP_MS * COUNTDOWN_STEPS;
const ANSWER_SPEECH_LANG = 'en-US';
const ANSWER_SPLIT_RE = /\s*(?:,|;|\/|\|)\s*/;

const initialGameState: GameState = {
  status: 'loading',
  score: 0,
  wordsDestroyed: 0,
  currentCard: null,
  particles: [],
  livesRemaining: INITIAL_LIVES,
};

type RoundSnapshot = {
  score: number;
  wordsDestroyed: number;
  livesRemaining: number;
  combo: number;
  bestCombo: number;
  failedWord?: GameResultType['failedWord'];
};

const clampValue = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const shuffleWords = (items: GameWord[]) => {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
};

const getCardTimeoutMs = (word: string) =>
  clampValue(
    5200 + (word.length * 180),
    MIN_CARD_TIMEOUT_MS,
    MAX_CARD_TIMEOUT_MS,
  );

const getNow = () => Date.now();
const getCardComboMultiplier = (combo: number) => Math.max(1, combo + 1);

const splitAcceptedAnswers = (value: string) => {
  const raw = value.trim();
  if (!raw) return [];

  const uniqueAnswers = new Set<string>();
  uniqueAnswers.add(normalizeEnglishAnswer(raw));

  raw
    .split(ANSWER_SPLIT_RE)
    .map((part) => normalizeEnglishAnswer(part))
    .filter(Boolean)
    .forEach((part) => uniqueAnswers.add(part));

  return [...uniqueAnswers];
};

const toGameWords = (items: WordItem[], promptLanguage: 'ru' | 'uz') =>
  items
    .map((item) => {
      const promptText = (item.translationNative ?? item.translationRu ?? '').trim();
      const primaryAnswer = item.wordEn.trim();
      const acceptedAnswers = splitAcceptedAnswers(primaryAnswer);

      if ((item.stage ?? 0) < 0 || !promptText || !primaryAnswer || !acceptedAnswers.length) {
        return null;
      }

      return {
        id: String(item.id),
        promptText,
        promptLanguage,
        answerLanguage: 'en' as const,
        primaryAnswer,
        acceptedAnswers,
        stage: item.stage ?? 0,
      };
    })
    .filter((item): item is GameWord => Boolean(item));

const readViewportMetrics = (): ViewportMetrics => {
  if (typeof window === 'undefined') {
    return { width: 1, height: 1, keyboardInset: 0 };
  }

  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width ?? window.innerWidth);
  const height = Math.round(viewport?.height ?? window.innerHeight);
  const keyboardInset = viewport
    ? Math.max(0, Math.round(window.innerHeight - (viewport.height + viewport.offsetTop)))
    : 0;

  return { width, height, keyboardInset };
};

const createHiddenRocket = (layout: ReturnType<typeof getGameCanvasLayout>): RocketVisual => ({
  phase: 'hidden',
  y: layout.rocketStartCenterY,
  opacity: 0,
  impactProgress: 0,
});

const createActiveRocket = (
  layout: ReturnType<typeof getGameCanvasLayout>,
  y: number = layout.rocketStartCenterY,
): RocketVisual => ({
  phase: 'active',
  y,
  opacity: 1,
  impactProgress: 0,
});

const createImpactRocket = (
  layout: ReturnType<typeof getGameCanvasLayout>,
  impactProgress: number,
  y: number = layout.rocketCollisionCenterY,
): RocketVisual => ({
  phase: 'impact',
  y,
  opacity: 1,
  impactProgress,
});

const getAnimationTimestamp = () =>
  typeof performance !== 'undefined' ? performance.now() : 0;

const getResponsiveLayout = (viewport: ViewportMetrics): LayoutMetrics => {
  const width = Math.max(viewport.width, 1);
  const height = Math.max(viewport.height, 1);
  const shortSide = Math.min(width, height);

  const sideInset = clampValue(width * 0.045, 12, 20);
  const topInset = clampValue(shortSide * 0.03, 10, 18);
  const compactGap = clampValue(shortSide * 0.02, 8, 14);
  const blockGap = clampValue(height * 0.022, 14, 24);

  const topButtonHeight = clampValue(shortSide * 0.095, 38, 48);
  const topButtonRadius = clampValue(topButtonHeight * 0.42, 18, 24);
  const topButtonPaddingX = clampValue(shortSide * 0.035, 12, 16);
  const topIconSize = clampValue(topButtonHeight * 0.36, 15, 18);
  const topButtonFontSize = clampValue(shortSide * 0.033, 12, 14);

  const panelPaddingX = clampValue(width * 0.06, 18, 28);
  const panelPaddingY = clampValue(height * 0.028, 18, 28);
  const panelRadius = clampValue(shortSide * 0.07, 24, 34);
  const panelMaxWidth = Math.min(width - (sideInset * 2), 480);

  const heroIconSize = clampValue(shortSide * 0.16, 52, 70);
  const startTopPadding = topInset + topButtonHeight + clampValue(height * 0.052, 28, 42);
  const startBottomPadding = clampValue(height * 0.03, 18, 26);

  const hudHeight = clampValue(shortSide * 0.135, 54, 68);
  const hudTopOffset = topInset;

  const speechPanelHeight = clampValue(shortSide * 0.092, 44, 50);
  const speechBottomGap =
    viewport.keyboardInset + clampValue(Math.max(height * 0.032, shortSide * 0.055), 24, 34);

  const sceneTopGap = clampValue(height * 0.012, 6, 10);
  const sceneBottomGap = clampValue(Math.max(height * 0.06, shortSide * 0.16), 48, 72);

  return {
    width,
    height,
    sideInset,
    topInset,
    compactGap,
    blockGap,
    topButtonHeight,
    topButtonRadius,
    topButtonPaddingX,
    topIconSize,
    topButtonFontSize,
    panelPaddingX,
    panelPaddingY,
    panelRadius,
    panelMaxWidth,
    heroIconSize,
    startTopPadding,
    startBottomPadding,
    hudHeight,
    hudTopOffset,
    speechPanelHeight,
    speechBottomGap,
    sceneTopGap,
    sceneBottomGap,
  };
};

const createWordCard = (
  word: GameWord,
  startOffsetY: number,
  timeoutMs: number,
  comboMultiplier: number,
  createdAt: number,
  collisionAt: number,
): WordCard => ({
  word,
  y: 0,
  startOffsetY,
  timeoutMs,
  createdAt,
  collisionAt,
  comboMultiplier,
});

const createExplosion = (x: number, y: number, strength = 1): Particle[] =>
  Array.from({ length: 12 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const velocity = (1.8 + Math.random() * 1.8) * strength;
    return {
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      alpha: 1,
      color: ['#67e8f9', '#60a5fa', '#ffb164', '#ff8a3d'][Math.floor(Math.random() * 4)]!,
    };
  });

const updateParticles = (particles: Particle[], deltaMs: number) => {
  const step = deltaMs / FRAME_MS;
  return particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx * step,
      y: particle.y + particle.vy * step,
      alpha: Math.max(0, particle.alpha - (deltaMs / PARTICLE_LIFETIME_MS)),
    }))
    .filter((particle) => particle.alpha > 0.02);
};

const getSpeechErrorText = (
  errorCode: SpeechErrorCode | null,
  fallbackError: string | null,
  t: TranslateFn
) => {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return t('gameMicErrorDenied');
    case 'audio-capture':
      return t('gameMicErrorUnavailable');
    case 'network':
      return t('gameMicErrorNetwork');
    case 'not-supported':
    case 'unknown':
      return t('gameMicErrorGeneric');
    default:
      return fallbackError;
  }
};

const RocketGame = ({ onBackToMenu, lang, t }: RocketGameProps) => {
  const [eligibleWords, setEligibleWords] = useState<GameWord[]>([]);
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [result, setResult] = useState<GameResultType | null>(null);
  const [loadError, setLoadError] = useState('');
  const [micModalOpen, setMicModalOpen] = useState(false);
  const [countdownValue, setCountdownValue] = useState(COUNTDOWN_STEPS);
  const [viewportMetrics, setViewportMetrics] = useState(readViewportMetrics);
  const [overlayHeights, setOverlayHeights] = useState<OverlayHeights>({ hud: 0, speech: 0 });
  const gameStatusRef = useRef<GameStatus>(initialGameState.status);
  const wordQueueRef = useRef<GameWord[]>([]);
  const activeIndexRef = useRef(0);
  const pauseStartedAtRef = useRef<number | null>(null);
  const countdownStartedAtRef = useRef<number | null>(null);
  const lastTranscriptRef = useRef('');
  const currentCardRef = useRef<WordCard | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const exitRef = useRef<{
    startedAt: number | null;
    nextScore: number;
    nextWordsDestroyed: number;
    nextLivesRemaining: number;
    nextCombo: number;
    nextBestCombo: number;
  }>({
    startedAt: null,
    nextScore: 0,
    nextWordsDestroyed: 0,
    nextLivesRemaining: INITIAL_LIVES,
    nextCombo: 0,
    nextBestCombo: 0,
  });
  const impactStartedAtRef = useRef<number | null>(null);
  const impactResolutionRef = useRef<RoundSnapshot & { endGame: boolean }>({
    score: 0,
    wordsDestroyed: 0,
    livesRemaining: INITIAL_LIVES,
    combo: 0,
    bestCombo: 0,
    failedWord: null,
    endGame: false,
  });
  const sceneRef = useRef<CanvasScene>({
    status: 'loading',
    currentCard: null,
    particles: [],
    timeLeftProgress: 1,
    cardFadeProgress: 0,
    rocket: {
      phase: 'hidden',
      y: 0,
      opacity: 0,
      impactProgress: 0,
    },
    launchStartedAt: null,
  });
  const hudDockRef = useRef<HTMLDivElement | null>(null);
  const speechDockRef = useRef<HTMLDivElement | null>(null);

  const ui = getResponsiveLayout(viewportMetrics);
  const hudReserveHeight = Math.max(overlayHeights.hud, ui.hudHeight);
  const speechReserveHeight = Math.max(overlayHeights.speech, ui.speechPanelHeight);
  const canvasLayout = getGameCanvasLayout({
    width: ui.width,
    height: ui.height,
    topReserveHeight: ui.hudTopOffset + hudReserveHeight + ui.sceneTopGap,
    bottomReserveHeight: ui.speechBottomGap + speechReserveHeight + ui.sceneBottomGap,
  });

  useEffect(() => {
    gameStatusRef.current = gameState.status;
  }, [gameState.status]);

  const syncScene = (patch: Partial<CanvasScene>) => {
    sceneRef.current = {
      ...sceneRef.current,
      ...patch,
      cardFadeProgress: patch.cardFadeProgress ?? (patch.status === 'exiting' ? sceneRef.current.cardFadeProgress : 0),
    };
  };

  const getActiveRocket = () => createActiveRocket(canvasLayout);

  const buildRoundCard = (
    word: GameWord,
    comboMultiplier: number,
    createdAt: number = getNow(),
  ) => {
    const timeoutMs = getCardTimeoutMs(word.promptText);
    const startOffsetY = 0;
    const card = createWordCard(
      word,
      startOffsetY,
      timeoutMs,
      comboMultiplier,
      createdAt,
      createdAt + timeoutMs,
    );

    return {
      ...card,
      y: canvasLayout.cardStartY + startOffsetY,
    };
  };

  const clearRoundTransitions = () => {
    exitRef.current = {
      startedAt: null,
      nextScore: gameState.score,
      nextWordsDestroyed: gameState.wordsDestroyed,
      nextLivesRemaining: gameState.livesRemaining,
      nextCombo: combo,
      nextBestCombo: bestCombo,
    };
    impactStartedAtRef.current = null;
    impactResolutionRef.current = {
      score: gameState.score,
      wordsDestroyed: gameState.wordsDestroyed,
      livesRemaining: gameState.livesRemaining,
      combo,
      bestCombo,
      failedWord: null,
      endGame: false,
    };
    countdownStartedAtRef.current = null;
  };

  const resetToIdleState = () => {
    clearRoundTransitions();
    setCountdownValue(COUNTDOWN_STEPS);
    pauseStartedAtRef.current = null;
    currentCardRef.current = null;
    particlesRef.current = [];

    syncScene({
      status: 'idle',
      currentCard: null,
      particles: [],
      timeLeftProgress: 1,
      rocket: createHiddenRocket(canvasLayout),
      launchStartedAt: null,
    });

    setGameState((prev) => ({
      ...prev,
      status: 'idle',
      currentCard: null,
      particles: [],
    }));
    gameStatusRef.current = 'idle';
  };

  const activateRound = (card: WordCard, options?: {
    score?: number;
    wordsDestroyed?: number;
    livesRemaining?: number;
    particles?: Particle[];
  }, startLaunchSequence = false) => {
    countdownStartedAtRef.current = null;
    setCountdownValue(COUNTDOWN_STEPS);
    currentCardRef.current = card;
    const nextParticles = options?.particles ?? particlesRef.current;
    particlesRef.current = nextParticles;
    const nextLaunchStartedAt = startLaunchSequence
      ? getAnimationTimestamp()
      : sceneRef.current.launchStartedAt;

    syncScene({
      currentCard: card,
      timeLeftProgress: 1,
      status: 'playing',
      particles: nextParticles,
      rocket: getActiveRocket(),
      launchStartedAt: nextLaunchStartedAt,
    });

    setGameState((prev) => ({
      ...prev,
      status: 'playing',
      score: options?.score ?? prev.score,
      wordsDestroyed: options?.wordsDestroyed ?? prev.wordsDestroyed,
      currentCard: card,
      particles: nextParticles,
      livesRemaining: options?.livesRemaining ?? prev.livesRemaining,
    }));
    gameStatusRef.current = 'playing';

    if (!speech.isIOS && !speech.isListening) {
      speech.startListening();
    }
  };

  const pauseGame = () => {
    if (gameStatusRef.current !== 'playing') return;

    speech.stopListening();
    pauseStartedAtRef.current = getNow();

    syncScene({
      status: 'paused',
      currentCard: currentCardRef.current,
      rocket: sceneRef.current.rocket,
    });

    setGameState((prev) => ({
      ...prev,
      status: 'paused',
      currentCard: currentCardRef.current,
    }));
    gameStatusRef.current = 'paused';
  };

  const getRoundPositions = (card: WordCard, now: number = getNow()) => {
    const movementDurationMs = Math.max(FRAME_MS, card.collisionAt - card.createdAt);
    const elapsedMs = Math.max(0, now - card.createdAt);
    const movementProgress = clampValue(elapsedMs / movementDurationMs, 0, 1);
    const startY = canvasLayout.cardStartY + card.startOffsetY;
    const cardCollisionY = canvasLayout.collisionContactY - canvasLayout.cardHeight;
    const cardY = startY + ((cardCollisionY - startY) * movementProgress);
    const rocketY = canvasLayout.rocketStartCenterY;

    return {
      elapsedMs,
      movementProgress,
      cardY,
      rocketY,
      cardBottomY: cardY + canvasLayout.cardHeight,
      rocketNoseY: rocketY - canvasLayout.rocketNoseOffset,
      timeLeftProgress: Math.max(0, 1 - (elapsedMs / card.timeoutMs)),
    };
  };

  const finishGame = (snapshot?: Pick<GameState, 'score' | 'wordsDestroyed'> & {
    livesRemaining?: number;
    bestCombo?: number;
    failedWord?: GameResultType['failedWord'];
  }) => {
    clearRoundTransitions();
    pauseStartedAtRef.current = null;
    const nextResult = {
      score: snapshot?.score ?? gameState.score,
      wordsDestroyed: snapshot?.wordsDestroyed ?? gameState.wordsDestroyed,
      bestCombo: snapshot?.bestCombo ?? bestCombo,
      failedWord: snapshot?.failedWord ?? null,
    };

    currentCardRef.current = null;
    syncScene({
      status: 'finished',
      currentCard: null,
      particles: particlesRef.current,
      timeLeftProgress: 0,
      rocket: createHiddenRocket(canvasLayout),
      launchStartedAt: null,
    });

    setResult(nextResult);
    setGameState((prev) => ({
      ...prev,
      status: 'finished',
      currentCard: null,
      particles: particlesRef.current,
      livesRemaining: snapshot?.livesRemaining ?? prev.livesRemaining,
    }));
    gameStatusRef.current = 'finished';
    speech.stopListening();
  };

  const spawnNextCard = (snapshot: RoundSnapshot) => {
    pauseStartedAtRef.current = null;
    clearRoundTransitions();
    const nextIndex = activeIndexRef.current + 1;
    if (nextIndex >= wordQueueRef.current.length) {
      finishGame(snapshot);
      return;
    }

    activeIndexRef.current = nextIndex;
    lastTranscriptRef.current = '';

    const nextCard = buildRoundCard(
      wordQueueRef.current[nextIndex]!,
      getCardComboMultiplier(snapshot.combo),
    );
    activateRound(nextCard, {
      score: snapshot.score,
      wordsDestroyed: snapshot.wordsDestroyed,
      livesRemaining: snapshot.livesRemaining,
      particles: particlesRef.current,
    });
  };

  const beginImpact = (card: WordCard, impactCardY: number) => {
    if (gameStatusRef.current !== 'playing') return;

    clearRoundTransitions();
    pauseStartedAtRef.current = null;
    speech.stopListening();
    setCombo(0);
    const nextLivesRemaining = Math.max(0, gameState.livesRemaining - 1);
    const collisionCard = {
      ...card,
      y: impactCardY,
    };
    const failedWord = {
      promptText: collisionCard.word.promptText,
      answerText: collisionCard.word.primaryAnswer,
      promptLanguage: collisionCard.word.promptLanguage,
      answerLanguage: collisionCard.word.answerLanguage,
    };

    currentCardRef.current = collisionCard;
    impactStartedAtRef.current = getNow();
    impactResolutionRef.current = {
      score: gameState.score,
      wordsDestroyed: gameState.wordsDestroyed,
      livesRemaining: nextLivesRemaining,
      combo: 0,
      bestCombo,
      failedWord,
      endGame: nextLivesRemaining === 0,
    };
    gameStatusRef.current = 'impact';
    particlesRef.current = [
      ...particlesRef.current,
      ...createExplosion(canvasLayout.width / 2, canvasLayout.collisionContactY, 1.25),
    ];

    syncScene({
      status: 'impact',
      currentCard: collisionCard,
      particles: particlesRef.current,
      timeLeftProgress: 0,
      rocket: createImpactRocket(canvasLayout, 0),
    });

    setGameState((prev) => ({
      ...prev,
      status: 'impact',
      currentCard: collisionCard,
      particles: particlesRef.current,
      livesRemaining: nextLivesRemaining,
    }));
  };

  const resumeGame = () => {
    if (gameStatusRef.current !== 'paused') return;

    const pausedAt = pauseStartedAtRef.current;
    const pausedDuration = pausedAt === null ? 0 : getNow() - pausedAt;
    pauseStartedAtRef.current = null;

    if (currentCardRef.current && pausedAt !== null) {
      currentCardRef.current = {
        ...currentCardRef.current,
        createdAt: currentCardRef.current.createdAt + pausedDuration,
        collisionAt: currentCardRef.current.collisionAt + pausedDuration,
      };
    }

    syncScene({
      status: 'playing',
      currentCard: currentCardRef.current,
      rocket: getActiveRocket(),
    });

    setGameState((prev) => ({
      ...prev,
      status: 'playing',
      currentCard: currentCardRef.current,
    }));
    gameStatusRef.current = 'playing';

    if (!speech.isIOS) {
      speech.startListening();
    }
  };

  const speech = useSpeechRecognition({
    language: ANSWER_SPEECH_LANG,
    onResult: (spoken) => {
      const currentCard = currentCardRef.current;
      const transcript = normalizeEnglishAnswer(spoken);

      if (gameStatusRef.current !== 'playing' || !currentCard || !transcript) return;
      if (lastTranscriptRef.current === transcript) return;

      lastTranscriptRef.current = transcript;
      if (currentCard.word.acceptedAnswers.some((answer) => isMatch(transcript, answer))) {
        const nextDestroyed = gameState.wordsDestroyed + 1;
        const awardedScore = Math.min(BASE_SCORE_PER_WORD * currentCard.comboMultiplier, MAX_SCORE_PER_WORD);
        const nextScore = gameState.score + awardedScore;
        const nextCombo = combo + 1;
        const nextBestCombo = Math.max(bestCombo, nextCombo);
        const roundPositions = getRoundPositions(currentCard);
        const resolvedCard = {
          ...currentCard,
          y: roundPositions.cardY,
        };

        clearRoundTransitions();
        pauseStartedAtRef.current = null;
        speech.stopListening();
        currentCardRef.current = resolvedCard;
        particlesRef.current = [
          ...particlesRef.current,
          ...createExplosion(
            canvasLayout.width / 2,
            roundPositions.cardY + (canvasLayout.cardHeight * 0.44),
            1.08
          ),
        ];
        exitRef.current = {
          startedAt: getNow(),
          nextScore,
          nextWordsDestroyed: nextDestroyed,
          nextLivesRemaining: gameState.livesRemaining,
          nextCombo,
          nextBestCombo,
        };
        gameStatusRef.current = 'exiting';

        syncScene({
          status: 'exiting',
          currentCard: resolvedCard,
          particles: particlesRef.current,
          timeLeftProgress: 0,
          cardFadeProgress: 0,
        });

        setCombo(nextCombo);
        setBestCombo(nextBestCombo);
        setGameState((prev) => ({
          ...prev,
          status: 'exiting',
          score: nextScore,
          wordsDestroyed: nextDestroyed,
          currentCard: resolvedCard,
          particles: particlesRef.current,
          livesRemaining: gameState.livesRemaining,
        }));
      }
    },
    onPermissionDenied: () => {
      if (gameStatusRef.current === 'countdown') {
        resetToIdleState();
      } else {
        pauseGame();
      }
      setMicModalOpen(true);
    },
  });

  useEffect(() => {
    const updateViewport = () => {
      setViewportMetrics(readViewportMetrics());
    };

    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);

    return () => {
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
    };
  }, []);

  useEffect(() => {
    const measureOverlays = () => {
      const nextHud = hudDockRef.current?.offsetHeight ?? 0;
      const nextSpeech = speechDockRef.current?.offsetHeight ?? 0;

      setOverlayHeights((prev) => (
        prev.hud === nextHud && prev.speech === nextSpeech
          ? prev
          : { hud: nextHud, speech: nextSpeech }
      ));
    };

    measureOverlays();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureOverlays);
      return () => window.removeEventListener('resize', measureOverlays);
    }

    const observer = new ResizeObserver(measureOverlays);
    if (hudDockRef.current) observer.observe(hudDockRef.current);
    if (speechDockRef.current) observer.observe(speechDockRef.current);
    window.addEventListener('resize', measureOverlays);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureOverlays);
    };
  }, [ui.height, ui.width]);

  const loadWords = async () => {
    clearRoundTransitions();
    speech.stopListening();
    pauseStartedAtRef.current = null;
    countdownStartedAtRef.current = null;
    setCountdownValue(COUNTDOWN_STEPS);
    setLoadError('');
    setResult(null);
    setCombo(0);
    setBestCombo(0);
    currentCardRef.current = null;
    particlesRef.current = [];

    syncScene({
      status: 'loading',
      currentCard: null,
      particles: [],
      timeLeftProgress: 1,
      rocket: createHiddenRocket(canvasLayout),
      launchStartedAt: null,
    });

    setGameState({
      ...initialGameState,
      status: 'loading',
    });
    gameStatusRef.current = 'loading';

    try {
      const response = await api.getWords(undefined, WORD_LIMIT, 0);
      const nextWords = toGameWords(response.items ?? [], lang);
      setEligibleWords(nextWords);
      resetToIdleState();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('loadWordsError');
      setLoadError(message);
      setEligibleWords([]);
      resetToIdleState();
    }
  };

  const startGame = () => {
    if (eligibleWords.length < MIN_WORDS) return;

    clearRoundTransitions();
    pauseStartedAtRef.current = null;
    setMicModalOpen(false);
    setLoadError('');
    setResult(null);
    setCombo(0);
    setBestCombo(0);
    lastTranscriptRef.current = '';

    const shuffled = shuffleWords(eligibleWords);
    wordQueueRef.current = shuffled;
    activeIndexRef.current = 0;

    currentCardRef.current = null;
    particlesRef.current = [];
    countdownStartedAtRef.current = getNow();
    setCountdownValue(COUNTDOWN_STEPS);

    syncScene({
      status: 'countdown',
      currentCard: null,
      particles: [],
      timeLeftProgress: 1,
      rocket: getActiveRocket(),
      launchStartedAt: null,
    });

    setGameState({
      status: 'countdown',
      score: 0,
      wordsDestroyed: 0,
      currentCard: null,
      particles: [],
      livesRemaining: INITIAL_LIVES,
    });
    gameStatusRef.current = 'countdown';
    speech.startListening();
  };

  useEffect(() => {
    if (!speech.isSupported) {
      return;
    }

    const loadTimer = window.setTimeout(() => {
      void loadWords();
    }, 0);

    return () => {
      window.clearTimeout(loadTimer);
      clearRoundTransitions();
      speech.stopListening();
    };
    // Initial game bootstrap only. The callbacks read current refs/state internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useGameLoop(
    gameState.status === 'countdown' || gameState.status === 'playing' || gameState.status === 'exiting' || gameState.status === 'impact',
    (deltaMs) => {
      const status = gameStatusRef.current;
      if (status === 'finished') return;

      const nextParticles = updateParticles(particlesRef.current, deltaMs);
      particlesRef.current = nextParticles;

      const now = getNow();

      if (status === 'countdown') {
        const countdownStartedAt = countdownStartedAtRef.current ?? now;
        const elapsedMs = Math.max(0, now - countdownStartedAt);
        const remainingMs = Math.max(0, COUNTDOWN_TOTAL_MS - elapsedMs);
        const nextCountdownValue = Math.max(1, Math.ceil(remainingMs / COUNTDOWN_STEP_MS));
        setCountdownValue((prev) => (prev === nextCountdownValue ? prev : nextCountdownValue));

        syncScene({
          status,
          currentCard: null,
          particles: nextParticles,
          timeLeftProgress: 1,
          rocket: getActiveRocket(),
          launchStartedAt: null,
        });

        if (remainingMs <= 0) {
          const firstWord = wordQueueRef.current[0];
          if (!firstWord) {
            resetToIdleState();
            return;
          }

          const roundStartedAt = getNow();
          const firstCard = buildRoundCard(firstWord, getCardComboMultiplier(0), roundStartedAt);
          activateRound(firstCard, {
            score: 0,
            wordsDestroyed: 0,
            livesRemaining: INITIAL_LIVES,
            particles: nextParticles,
          }, true);
        }
        return;
      }

      if (status === 'playing') {
        const currentCard = currentCardRef.current;
        if (!currentCard) {
          syncScene({
            status,
            currentCard: null,
            particles: nextParticles,
            timeLeftProgress: 0,
            rocket: getActiveRocket(),
          });
          return;
        }

        const round = getRoundPositions(currentCard, now);
        const nextCard = {
          ...currentCard,
          y: round.cardY,
        };

        currentCardRef.current = nextCard;

        if (round.cardBottomY >= round.rocketNoseY) {
          beginImpact(nextCard, round.cardY);
          return;
        }

        syncScene({
          status,
          currentCard: nextCard,
          particles: nextParticles,
          timeLeftProgress: round.timeLeftProgress,
          rocket: getActiveRocket(),
        });
        return;
      }

      if (status === 'exiting') {
        const currentCard = currentCardRef.current;
        if (!currentCard) {
          finishGame({
            score: exitRef.current.nextScore,
            wordsDestroyed: exitRef.current.nextWordsDestroyed,
            livesRemaining: exitRef.current.nextLivesRemaining,
            bestCombo: exitRef.current.nextBestCombo,
          });
          return;
        }

        const exitStartedAt = exitRef.current.startedAt ?? now;
        const exitProgress = clampValue((now - exitStartedAt) / SUCCESS_EXIT_DURATION_MS, 0, 1);
        syncScene({
          status,
          currentCard,
          particles: nextParticles,
          timeLeftProgress: 0,
          cardFadeProgress: exitProgress,
          rocket: getActiveRocket(),
        });

        if (exitProgress >= 1) {
          if (activeIndexRef.current + 1 >= wordQueueRef.current.length) {
            finishGame({
              score: exitRef.current.nextScore,
              wordsDestroyed: exitRef.current.nextWordsDestroyed,
              livesRemaining: exitRef.current.nextLivesRemaining,
              bestCombo: exitRef.current.nextBestCombo,
            });
            return;
          }

          spawnNextCard({
            score: exitRef.current.nextScore,
            wordsDestroyed: exitRef.current.nextWordsDestroyed,
            livesRemaining: exitRef.current.nextLivesRemaining,
            combo: exitRef.current.nextCombo,
            bestCombo: exitRef.current.nextBestCombo,
          });
        }
        return;
      }

      const currentCard = currentCardRef.current;
      if (!currentCard) {
        finishGame({
          score: gameState.score,
          wordsDestroyed: gameState.wordsDestroyed,
          bestCombo,
        });
        return;
      }

      const impactStartedAt = impactStartedAtRef.current ?? now;
      const impactProgress = clampValue((now - impactStartedAt) / IMPACT_DURATION_MS, 0, 1);

      syncScene({
        status,
        currentCard,
        particles: nextParticles,
        timeLeftProgress: 0,
        rocket: createImpactRocket(canvasLayout, impactProgress),
      });

      if (impactProgress >= 1) {
        const impactResolution = impactResolutionRef.current;
        if (impactResolution.endGame) {
          finishGame(impactResolution);
          return;
        }

        spawnNextCard(impactResolution);
      }
    }
  );

  const copy = {
    title: t('gameTitle'),
    distanceLabel: t('gameDistance'),
    distanceUnit: t('gameDistanceUnit'),
    menu: t('gameMenu'),
    refresh: t('gameRefresh'),
    unsupportedBadge: t('gameUnsupportedBadge'),
    unsupportedTitle: t('gameUnsupportedTitle'),
    unsupportedBody: t('gameUnsupportedBody'),
    loadingBadge: t('gameLoadingBadge'),
    loadingTitle: t('gameLoadingTitle'),
    loadingBody: t('gameLoadingBody'),
    needWordsBadge: t('gameNeedWordsBadge'),
    needWordsTitle: t('gameNeedWordsTitle', { count: MIN_WORDS }),
    needWordsBody: t('gameNeedWordsBody', { countReady: eligibleWords.length }),
    startBody: lang === 'uz'
      ? "Kartadagi so'zning inglizcha tarjimasini raketa urilishidan oldin ayting."
      : 'Скажи английский перевод слова на карточке раньше, чем произойдёт столкновение.',
    startReady: t('gameStartReady', { count: eligibleWords.length }),
    startButton: t('gameStartButton'),
    loadFailedBadge: t('gameLoadFailedBadge'),
    tryAgain: t('gameTryAgain'),
    back: t('gameBack'),
    backToMenu: t('gameBackToMenu'),
    micRequiredBadge: t('gameMicRequiredBadge'),
    micRequiredTitle: t('gameMicRequiredTitle'),
    micRequiredBody: t('gameMicRequiredBody'),
    close: t('gameClose'),
    micStatusReady: t('gameMicStatusReady'),
    micStatusListening: t('gameMicStatusListening'),
    micStatusProcessing: t('gameMicStatusProcessing'),
    micStatusError: t('gameMicStatusError'),
    micStatusLocked: t('gameMicStatusLocked'),
    countdownTitle: lang === 'uz' ? 'Tayyorlan' : 'Готовься',
    countdownHint: lang === 'uz' ? "Mikrofon yoqildi. Startdan keyin inglizcha ayting." : 'Микрофон уже включён. После старта говори по-английски.',
    micHintIos: t('gameMicHintIos'),
    micHintAuto: t('gameMicHintAuto'),
    micHintTap: t('gameMicHintTap'),
    autoMode: t('gameAutoMode'),
    holdToSpeak: t('gameHoldToSpeak'),
    startMic: t('gameStartMic'),
    retryMic: t('gameRetryMic'),
    wordsLabel: t('gameWords'),
    comboLabel: t('gameCombo'),
    speedLabel: t('gameSpeed'),
    resultBadge: t('gameResultBadge'),
    resultHeadline: lang === 'uz' ? "Zo'r!" : 'Отлично!',
    resultDistance: t('gameResultDistance'),
    resultWords: t('gameResultWords'),
    resultBestCombo: t('gameResultBestCombo'),
    failedWordTitle: lang === 'uz' ? "Seni to'xtatgan so'z" : 'Слово, которое тебя остановило',
    playAgain: t('gamePlayAgain'),
  };

  const hasSpeechError = speech.status === 'error' && Boolean(speech.error || speech.errorCode);
  const speechErrorText = hasSpeechError
    ? getSpeechErrorText(speech.errorCode, speech.error, t)
    : null;
  const canManuallyControlSpeech = gameState.status === 'playing';

  const speechLabel = (() => {
    if (hasSpeechError) return speechErrorText ?? copy.micStatusError;
    if (gameState.status === 'countdown') {
      return speech.status === 'listening' || speech.status === 'processing'
        ? copy.countdownHint
        : copy.micStatusReady;
    }
    if (gameState.status === 'exiting' || gameState.status === 'impact') return copy.micStatusLocked;
    if (speech.status === 'processing') return copy.micStatusProcessing;
    if (speech.status === 'listening') return copy.micStatusListening;
    return copy.micStatusReady;
  })();

  const speechActionLabel = !canManuallyControlSpeech
    ? null
    : speech.isIOS
      ? (hasSpeechError ? copy.retryMic : copy.holdToSpeak)
      : !speech.isListening || hasSpeechError
        ? hasSpeechError
          ? copy.retryMic
          : copy.startMic
        : null;

  const wordsReady = eligibleWords.length >= MIN_WORDS;
  const isGameVisible =
    gameState.status === 'countdown' ||
    gameState.status === 'playing' ||
    gameState.status === 'exiting' ||
    gameState.status === 'impact' ||
    gameState.status === 'paused' ||
    gameState.status === 'finished';
  const showTopbar = !isGameVisible;
  const resultSubtitle = result
    ? (lang === 'uz'
      ? `Sen ${result.wordsDestroyed} so'zni yiqitding`
      : `Сбито ${result.wordsDestroyed} слов`)
    : t('gameResultSubtitle');
  const resultHeadline = result && result.wordsDestroyed === 0
    ? (lang === 'uz' ? "Yana urinib ko'r" : 'Попробуй ещё')
    : copy.resultHeadline;

  const closeMicModal = () => {
    setMicModalOpen(false);
    if (gameState.status === 'paused') {
      onBackToMenu();
    }
  };

  const pageStyle: GamePageStyle = {
    position: 'relative',
    width: '100%',
    height: ui.height,
    minHeight: ui.height,
    '--rg-side-inset': `${ui.sideInset}px`,
    '--rg-top-inset': `${ui.topInset}px`,
    '--rg-compact-gap': `${ui.compactGap}px`,
    '--rg-block-gap': `${ui.blockGap}px`,
    '--rg-top-button-height': `${ui.topButtonHeight}px`,
    '--rg-top-button-radius': `${ui.topButtonRadius}px`,
    '--rg-top-button-padding-x': `${ui.topButtonPaddingX}px`,
    '--rg-top-icon-size': `${ui.topIconSize}px`,
    '--rg-top-button-font-size': `${ui.topButtonFontSize}px`,
    '--rg-panel-padding-x': `${ui.panelPaddingX}px`,
    '--rg-panel-padding-y': `${ui.panelPaddingY}px`,
    '--rg-panel-radius': `${ui.panelRadius}px`,
    '--rg-panel-max-width': `${ui.panelMaxWidth}px`,
    '--rg-hero-icon-size': `${ui.heroIconSize}px`,
    '--rg-start-top-padding': `${ui.startTopPadding}px`,
    '--rg-start-bottom-padding': `${ui.startBottomPadding}px`,
    '--rg-hud-height': `${ui.hudHeight}px`,
    '--rg-hud-top-offset': `${ui.hudTopOffset}px`,
    '--rg-speech-height': `${ui.speechPanelHeight}px`,
    '--rg-speech-bottom-gap': `${ui.speechBottomGap}px`,
  };

  return (
    <div className={`rocket-game-page rocket-game-page--${lang}`} style={pageStyle}>
      {showTopbar && (
        <div className="rocket-game__topbar">
          <button type="button" className="rocket-game__topbar-btn" onClick={onBackToMenu}>
            <ArrowLeft size={ui.topIconSize} />
            <span>{copy.menu}</span>
          </button>

          <button type="button" className="rocket-game__topbar-btn" onClick={() => { void loadWords(); }}>
            <RefreshCcw size={ui.topIconSize} />
            <span>{copy.refresh}</span>
          </button>
        </div>
      )}

      {!speech.isSupported && (
        <div className="rocket-game__center-shell">
          <div className="rocket-game__panel rocket-game__panel--center">
            <div className="rocket-game__badge">{copy.unsupportedBadge}</div>
            <h2>{copy.unsupportedTitle}</h2>
            <p>{copy.unsupportedBody}</p>
            <button type="button" className="btn-primary" onClick={onBackToMenu}>
              {copy.backToMenu}
            </button>
          </div>
        </div>
      )}

      {speech.isSupported && gameState.status === 'loading' && (
        <div className="rocket-game__center-shell">
          <div className="rocket-game__panel rocket-game__panel--center">
            <div className="rocket-game__badge">{copy.loadingBadge}</div>
            <h2>{copy.loadingTitle}</h2>
            <p>{copy.loadingBody}</p>
          </div>
        </div>
      )}

      {speech.isSupported && gameState.status === 'idle' && !loadError && !wordsReady && (
        <div className="rocket-game__center-shell">
          <div className="rocket-game__panel rocket-game__panel--center">
            <div className="rocket-game__badge">{copy.needWordsBadge}</div>
            <h2>{copy.needWordsTitle}</h2>
            <p>{copy.needWordsBody}</p>
            <button type="button" className="btn-primary" onClick={onBackToMenu}>
              {copy.backToMenu}
            </button>
          </div>
        </div>
      )}

      {speech.isSupported && gameState.status === 'idle' && wordsReady && (
        <div className="rocket-game__start-screen">
          <div className="rocket-game__start-hero">
            <div className="rocket-game__start-icon" aria-hidden="true">
              <Rocket size={ui.heroIconSize} strokeWidth={1.9} />
            </div>
            <h1>{copy.title}</h1>
            <p>{copy.startBody}</p>
            <div className="rocket-game__badge rocket-game__badge--accent">{copy.startReady}</div>
          </div>

          <button type="button" className="btn-primary rocket-game__start-btn" onClick={startGame}>
            {copy.startButton}
          </button>
        </div>
      )}

      {speech.isSupported && loadError && (
        <div className="rocket-game__center-shell">
          <div className="rocket-game__panel rocket-game__panel--center">
            <div className="rocket-game__badge rocket-game__badge--error">{copy.loadFailedBadge}</div>
            <h2>{loadError}</h2>
            <div className="rocket-game__inline-actions">
              <button type="button" className="btn-primary" onClick={() => { void loadWords(); }}>
                {copy.tryAgain}
              </button>
              <button type="button" className="btn-ghost btn-compact" onClick={onBackToMenu}>
                {copy.back}
              </button>
            </div>
          </div>
        </div>
      )}

      {speech.isSupported && isGameVisible && (
        <div className="rocket-game__arena">
          <div ref={hudDockRef} className="rocket-game__hud-dock">
            <GameHUD
              score={gameState.score}
              distanceLabel={copy.distanceLabel}
              distanceUnit={copy.distanceUnit}
              livesRemaining={gameState.livesRemaining}
              maxLives={INITIAL_LIVES}
            />
          </div>

          <div className="rocket-game__canvas-wrap">
            <GameCanvas sceneRef={sceneRef} layout={canvasLayout} />
          </div>

          <div ref={speechDockRef} className="rocket-game__speech-dock">
            <SpeechIndicator
              status={speech.status}
              label={speechLabel}
              isIOS={speech.isIOS}
              isListening={speech.isListening}
              hasError={hasSpeechError}
              disabled={gameState.status !== 'playing'}
              actionLabel={gameState.status === 'countdown' ? null : speechActionLabel}
              onTapStart={gameState.status === 'playing' ? speech.startListening : undefined}
              onHoldStart={gameState.status === 'playing' ? speech.startListening : undefined}
              onHoldEnd={gameState.status === 'playing' ? speech.stopListening : undefined}
            />
          </div>

          {gameState.status === 'countdown' && (
            <div className="rocket-game__countdown-overlay">
              <div className="rocket-game__countdown-card">
                <div className="rocket-game__badge rocket-game__badge--accent">{copy.countdownTitle}</div>
                <strong className="rocket-game__countdown-value">{countdownValue}</strong>
              </div>
            </div>
          )}

          {gameState.status === 'finished' && result && (
            <div className="rocket-game__result-overlay">
              <GameResult
                result={result}
                badge={copy.resultBadge}
                headline={resultHeadline}
                subtitle={resultSubtitle}
                failedWordTitle={copy.failedWordTitle}
                distanceLabel={copy.resultDistance}
                wordsLabel={copy.resultWords}
                comboLabel={copy.resultBestCombo}
                distanceUnit={copy.distanceUnit}
                playAgainLabel={copy.playAgain}
                backLabel={copy.backToMenu}
                onPlayAgain={startGame}
                onBackToMenu={onBackToMenu}
              />
            </div>
          )}
        </div>
      )}

      {micModalOpen && (
        <div className="rocket-modal" role="presentation" onClick={closeMicModal}>
          <div className="rocket-modal__card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="rocket-game__badge rocket-game__badge--error">{copy.micRequiredBadge}</div>
            <h3>{copy.micRequiredTitle}</h3>
            <p>{copy.micRequiredBody}</p>
            <div className="rocket-game__inline-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setMicModalOpen(false);
                  if (gameState.status === 'paused') {
                    resumeGame();
                  } else if (gameState.status === 'playing') {
                    speech.startListening();
                  } else {
                    startGame();
                  }
                }}
              >
                {copy.tryAgain}
              </button>
              <button
                type="button"
                className="btn-ghost btn-compact"
                onClick={closeMicModal}
              >
                {copy.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RocketGame;
