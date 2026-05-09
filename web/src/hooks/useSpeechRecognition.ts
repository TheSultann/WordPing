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

// Задержки для бесшовного перезапуска (loop)
const TRANSIENT_RESTART_DELAY_MS = 150;
const RESULT_RESTART_DELAY_MS = 10; // Мгновенный рестарт после успеха
const IDLE_RESTART_DELAY_MS = 50; 
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
  
  const SpeechRecognitionCtor = getSpeechCtor();
  const isSupported = Boolean(SpeechRecognitionCtor);

  onResultRef.current = onResult;
  onInterimResultRef.current = onInterimResult;
  onPermissionDeniedRef.current = onPermissionDenied;
  languageRef.current = language;

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
      // no-op
    }
  };

  const startRecognition = () => {
    const recognition = recognitionRef.current;
    if (!recognition || isStartingRef.current) return;
    if (isListeningRef.current) return;
    isStartingRef.current = true;

    try {
      recognition.lang = languageRef.current;
      // На iOS continuous: true часто ломается. 
      // На Android оставляем true, чтобы не было постоянного "пиканья" при рестартах.
      recognition.continuous = !isIOS;
      recognition.start();
      setError(null);
      setErrorCode(null);
    } catch {
      // Игнорируем InvalidStateError при частых перезапусках
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
      // КРИТИЧНО: Удерживаем MediaStream в памяти. 
      // Это предотвращает отключение микрофона ОС браузером!
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
    shouldKeepAliveRef.current = true;
    hadResultRef.current = false;
    lastErrorRef.current = null;
    clearRestartTimer();
    const requestId = startRequestIdRef.current + 1;
    startRequestIdRef.current = requestId;

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = languageRef.current;
      recognition.continuous = !isIOS;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      
      recognition.onstart = () => {
        isListeningRef.current = true;
        setError(null);
        setErrorCode(null);
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
          if (nextError === 'no-speech') setErrorCode('no-speech');
          setStatus('idle');
          return; // onend подхватит и сделает restart
        }

        if (nextError === 'not-allowed' || nextError === 'service-not-allowed') {
          shouldKeepAliveRef.current = false;
          onPermissionDeniedRef.current?.();
        }

        setError(getMicErrorMessage(nextError));
        setErrorCode(nextError as SpeechErrorCode);
        setStatus('error');
      };

      recognition.onend = () => {
        isListeningRef.current = false;
        setIsListening(false);

        if (manualStopRef.current || !shouldKeepAliveRef.current) {
          setStatus((prev) => (prev === 'error' ? prev : 'idle'));
          return;
        }

        // БЕСШОВНЫЙ ЦИКЛ: Как только распознавание остановилось (из-за паузы или мобильного лимита),
        // мы мгновенно запускаем его снова, не требуя от юзера нажатий кнопок!
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
      try { recognition.stop(); } catch {}
      try { recognition.abort(); } catch {}
    };
  }, []);

  return {
    transcript,
    isListening,
    isSupported,
    isIOS,
    error,
    errorCode,
    status,
    startListening,
    stopListening,
  };
};

export default useSpeechRecognition;