import { useEffect, useRef, useState } from 'react';

type SpeechStatus = 'idle' | 'listening' | 'processing' | 'error';

export type SpeechErrorCode =
  | 'not-supported'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'audio-capture'
  | 'network'
  | 'no-speech'
  | 'unknown';

type SpeechRecognitionResultLike = {
  0?: {
    transcript?: string;
  };
  isFinal?: boolean;
};

type SpeechRecognitionEventLike = {
  resultIndex?: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
  message?: string;
};

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onstart?: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

type SpeechWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionCtor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
};

export type UseSpeechRecognitionReturn = {
  transcript: string;
  isListening: boolean;
  isSupported: boolean;
  isIOS: boolean;
  requiresManualStart: boolean;
  error: string | null;
  errorCode: SpeechErrorCode | null;
  status: SpeechStatus;
  startListening: () => void;
  stopListening: (options?: { releaseMicrophone?: boolean }) => void;
};

type UseSpeechRecognitionOptions = {
  language?: string;
  onResult?: (spoken: string) => void;
  onInterimResult?: (spoken: string) => void;
  onPermissionDenied?: () => void;
};

const getSpeechCtor = () => {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
};

const getMicErrorMessage = (code?: string) => {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'Microphone access was denied.';
  }
  if (code === 'audio-capture') {
    return 'Microphone is unavailable.';
  }
  if (code === 'network') {
    return 'Speech recognition network error.';
  }
  if (code === 'no-speech') {
    return 'No speech detected.';
  }
  return 'Speech recognition failed.';
};

/** Delay before restarting after a transient error (no-speech, aborted). */
const TRANSIENT_RESTART_DELAY_MS = 150;

/** Delay before restarting after a result was delivered. */
const RESULT_RESTART_DELAY_MS = 0;

/** Delay before restarting when the session ended with no result and no error. */
const IDLE_RESTART_DELAY_MS = 120;

/** Cooldown after start() to prevent InvalidStateError on double-start. */
const START_GUARD_MS = 140;

export const useSpeechRecognition = (
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn => {
  const { language = 'en-US', onResult, onInterimResult, onPermissionDenied } = options;
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<SpeechErrorCode | null>(null);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const onResultRef = useRef(onResult);
  const onInterimResultRef = useRef(onInterimResult);
  const onPermissionDeniedRef = useRef(onPermissionDenied);
  const restartTimerRef = useRef<number | null>(null);
  const shouldKeepAliveRef = useRef(false);
  const manualStopRef = useRef(false);
  const hadResultRef = useRef(false);
  const lastErrorRef = useRef<string | null>(null);
  const isStartingRef = useRef(false);
  const isListeningRef = useRef(false);
  const micAccessPromiseRef = useRef<Promise<boolean> | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const startRequestIdRef = useRef(0);
  const languageRef = useRef(language);
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const hasTelegramWebApp =
    typeof window !== 'undefined' &&
    Boolean((window as Window & { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp);
  const requiresManualStart = isIOS || (isAndroid && hasTelegramWebApp);
  const requiresManualStartRef = useRef(requiresManualStart);
  const SpeechRecognitionCtor = getSpeechCtor();
  const isSupported = Boolean(SpeechRecognitionCtor);

  onResultRef.current = onResult;
  onInterimResultRef.current = onInterimResult;
  onPermissionDeniedRef.current = onPermissionDenied;
  languageRef.current = language;
  requiresManualStartRef.current = requiresManualStart;

  const clearRestartTimer = () => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const hasLiveMicStream = () => (
    micStreamRef.current?.getAudioTracks().some((track) => track.readyState === 'live') ?? false
  );

  const releaseMicrophoneStream = () => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
  };

  const stopListening = (options: { releaseMicrophone?: boolean } = {}) => {
    const { releaseMicrophone = true } = options;
    startRequestIdRef.current += 1;
    manualStopRef.current = true;
    shouldKeepAliveRef.current = false;
    clearRestartTimer();
    isListeningRef.current = false;
    setIsListening(false);
    setStatus((prev) => (prev === 'error' ? prev : 'idle'));
    if (releaseMicrophone) {
      releaseMicrophoneStream();
    }
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // no-op — may already be stopped
    }
  };

  const startRecognition = () => {
    const recognition = recognitionRef.current;
    if (!recognition || isStartingRef.current) return;
    if (isListeningRef.current) return;
    isStartingRef.current = true;

    try {
      recognition.lang = languageRef.current;
      recognition.continuous = requiresManualStartRef.current;
      recognition.start();
      setError(null);
      setErrorCode(null);
    } catch {
      // Guard against InvalidStateError when recognition is already started.
      // This can happen on fast double-calls (timer + UI). If the engine is
      // already running, the onstart handler will fire anyway, so we silently
      // absorb the exception instead of surfacing an error to the user.
    } finally {
      window.setTimeout(() => {
        isStartingRef.current = false;
      }, START_GUARD_MS);
    }
  };

  const ensureMicrophoneAccess = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return true;
    }
    if (hasLiveMicStream()) return true;
    if (micAccessPromiseRef.current) return micAccessPromiseRef.current;

    micAccessPromiseRef.current = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      releaseMicrophoneStream();
      micStreamRef.current = stream;
      return true;
    })().catch((err: unknown) => {
      releaseMicrophoneStream();
      const code = err instanceof DOMException ? err.name : '';
      const normalizedCode =
        code === 'NotAllowedError' || code === 'PermissionDeniedError'
          ? 'not-allowed'
          : code === 'NotFoundError' || code === 'DevicesNotFoundError'
            ? 'audio-capture'
            : 'unknown';
      setError(getMicErrorMessage(normalizedCode));
      setErrorCode(normalizedCode);
      setStatus('error');
      if (normalizedCode === 'not-allowed') {
        onPermissionDeniedRef.current?.();
      }
      return false;
    }).finally(() => {
      micAccessPromiseRef.current = null;
    });

    return micAccessPromiseRef.current;
  };

  const startListening = () => {
    if (!SpeechRecognitionCtor) {
      setError('Speech recognition is not supported in this browser.');
      setErrorCode('not-supported');
      setStatus('error');
      return;
    }

    setTranscript('');
    setError(null);
    setErrorCode(null);
    manualStopRef.current = false;
    // Keep the session active while the game is running. Manual-start platforms
    // do not auto-restart from timers; they rely on direct user gestures.
    shouldKeepAliveRef.current = true;
    hadResultRef.current = false;
    lastErrorRef.current = null;
    clearRestartTimer();
    const requestId = startRequestIdRef.current + 1;
    startRequestIdRef.current = requestId;

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = languageRef.current;
      recognition.continuous = requiresManualStartRef.current;
      // Enable interim results for instant matching — the game can react to
      // partial transcripts before the browser marks the result as final.
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        isListeningRef.current = true;
        setError(null);
        setIsListening(true);
        setStatus('listening');
      };

      recognition.onresult = (event) => {
        let finalSpoken = '';
        let interimSpoken = '';
        const startIndex = event.resultIndex ?? 0;

        for (let index = startIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result?.[0]?.transcript?.trim() ?? '';
          if (!text) continue;

          if (result?.isFinal) {
            finalSpoken = text;
          } else {
            interimSpoken = text;
          }
        }

        // Deliver interim results immediately so the game can match early.
        if (interimSpoken && !finalSpoken) {
          onInterimResultRef.current?.(interimSpoken);
          return;
        }

        if (!finalSpoken) return;

        hadResultRef.current = true;
        lastErrorRef.current = null;
        onResultRef.current?.(finalSpoken);
        setTranscript(finalSpoken);
        setStatus('processing');
      };

      recognition.onerror = (event) => {
        const nextError = event.error ?? 'unknown';
        lastErrorRef.current = nextError;
        isListeningRef.current = false;
        setIsListening(false);

        if (nextError === 'aborted' || nextError === 'no-speech') {
          // Transient errors — don't surface to UI, let onend handle restart.
          if (nextError === 'no-speech') {
            setErrorCode('no-speech');
          }
          setStatus('idle');
          return;
        }

        if (nextError === 'not-allowed' || nextError === 'service-not-allowed') {
          shouldKeepAliveRef.current = false;
          if (requiresManualStartRef.current && hasLiveMicStream()) {
            setStatus('idle');
            return;
          }
          onPermissionDeniedRef.current?.();
        }

        setError(getMicErrorMessage(nextError));
        setErrorCode(nextError as SpeechErrorCode);
        setStatus('error');
      };

      recognition.onend = () => {
        isListeningRef.current = false;
        setIsListening(false);

        if (manualStopRef.current) {
          setStatus((prev) => (prev === 'error' ? prev : 'idle'));
          return;
        }

        if (!shouldKeepAliveRef.current) {
          setStatus((prev) => (prev === 'error' ? prev : 'idle'));
          return;
        }

        if (requiresManualStartRef.current) {
          setStatus((prev) => (prev === 'error' ? prev : 'idle'));
          return;
        }

        // Auto-restart the recognition session. This is critical for the game:
        // desktop Chromium stops after every utterance when `continuous` is false.
        // Telegram WebView/iOS often reject timer-based restarts because they are
        // not user gestures, so those platforms use the visible mic control.
        const delay = lastErrorRef.current
          ? TRANSIENT_RESTART_DELAY_MS
          : hadResultRef.current
            ? RESULT_RESTART_DELAY_MS
            : IDLE_RESTART_DELAY_MS;
        hadResultRef.current = false;
        clearRestartTimer();
        restartTimerRef.current = window.setTimeout(() => {
          startRecognition();
        }, delay);
      };

      recognitionRef.current = recognition;
    }

    if (requiresManualStartRef.current) {
      if (manualStopRef.current || startRequestIdRef.current !== requestId) {
        return;
      }
      startRecognition();
      return;
    }

    void ensureMicrophoneAccess().then((granted) => {
      if (!granted) {
        shouldKeepAliveRef.current = false;
        return;
      }
      if (manualStopRef.current || startRequestIdRef.current !== requestId) {
        releaseMicrophoneStream();
        return;
      }
      startRecognition();
    });
  };

  useEffect(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.lang = language;
  }, [language]);

  useEffect(() => {
    return () => {
      startRequestIdRef.current += 1;
      clearRestartTimer();
      shouldKeepAliveRef.current = false;
      manualStopRef.current = true;
      isListeningRef.current = false;
      releaseMicrophoneStream();
      const recognition = recognitionRef.current;
      if (!recognition) return;
      try {
        recognition.stop();
      } catch {
        // no-op
      }
      try {
        recognition.abort();
      } catch {
        // no-op
      }
    };
  }, []);

  return {
    transcript,
    isListening,
    isSupported,
    isIOS,
    requiresManualStart,
    error,
    errorCode,
    status,
    startListening,
    stopListening,
  };
};

export default useSpeechRecognition;
