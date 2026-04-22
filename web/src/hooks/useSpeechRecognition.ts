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
  stopListening: () => void;
};

type UseSpeechRecognitionOptions = {
  language?: string;
  onResult?: (spoken: string) => void;
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

export const useSpeechRecognition = (
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn => {
  const { language = 'en-US', onResult, onPermissionDenied } = options;
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<SpeechErrorCode | null>(null);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const onResultRef = useRef(onResult);
  const onPermissionDeniedRef = useRef(onPermissionDenied);
  const restartTimerRef = useRef<number | null>(null);
  const shouldKeepAliveRef = useRef(false);
  const manualStopRef = useRef(false);
  const hadResultRef = useRef(false);
  const lastErrorRef = useRef<string | null>(null);
  const isStartingRef = useRef(false);
  const isListeningRef = useRef(false);
  const micAccessGrantedRef = useRef(false);
  const startRequestIdRef = useRef(0);
  const languageRef = useRef(language);
  const isIOS = /iPad|iPhone|iPod/i.test(
    typeof navigator === 'undefined' ? '' : navigator.userAgent
  );
  const SpeechRecognitionCtor = getSpeechCtor();
  const isSupported = Boolean(SpeechRecognitionCtor);

  onResultRef.current = onResult;
  onPermissionDeniedRef.current = onPermissionDenied;
  languageRef.current = language;

  const clearRestartTimer = () => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const stopListening = () => {
    startRequestIdRef.current += 1;
    manualStopRef.current = true;
    shouldKeepAliveRef.current = false;
    clearRestartTimer();
    isListeningRef.current = false;
    setIsListening(false);
    setStatus((prev) => (prev === 'error' ? prev : 'idle'));
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
      recognition.start();
      setError(null);
      setErrorCode(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Speech recognition failed.';
      setError(message);
      setErrorCode('unknown');
      isListeningRef.current = false;
      setIsListening(false);
      setStatus('error');
    } finally {
      window.setTimeout(() => {
        isStartingRef.current = false;
      }, 120);
    }
  };

  const ensureMicrophoneAccess = async () => {
    if (micAccessGrantedRef.current) return true;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return true;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      micAccessGrantedRef.current = true;
      return true;
    } catch (err) {
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
    }
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
    shouldKeepAliveRef.current = !isIOS;
    hadResultRef.current = false;
    lastErrorRef.current = null;
    clearRestartTimer();
    const requestId = startRequestIdRef.current + 1;
    startRequestIdRef.current = requestId;

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = languageRef.current;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        isListeningRef.current = true;
        setError(null);
        setIsListening(true);
        setStatus('listening');
      };

      recognition.onresult = (event) => {
        let spoken = '';
        const startIndex = event.resultIndex ?? 0;

        for (let index = startIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result?.isFinal && typeof result?.isFinal !== 'undefined') continue;
          spoken = result?.[0]?.transcript?.trim() ?? spoken;
        }

        if (!spoken) return;

        hadResultRef.current = true;
        lastErrorRef.current = null;
        onResultRef.current?.(spoken);
        setTranscript(spoken);
        setStatus('processing');
      };

      recognition.onerror = (event) => {
        const nextError = event.error ?? 'unknown';
        lastErrorRef.current = nextError;
        isListeningRef.current = false;
        setIsListening(false);

        if (nextError === 'aborted' || nextError === 'no-speech') {
          if (nextError === 'no-speech') {
            setErrorCode('no-speech');
          }
          setStatus('idle');
          return;
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

        if (manualStopRef.current) {
          setStatus((prev) => (prev === 'error' ? prev : 'idle'));
          return;
        }

        if (isIOS || !shouldKeepAliveRef.current) {
          setStatus((prev) => (prev === 'error' ? prev : 'idle'));
          return;
        }

        const delay = lastErrorRef.current ? 500 : hadResultRef.current ? 0 : 250;
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
    error,
    errorCode,
    status,
    startListening,
    stopListening,
  };
};

export default useSpeechRecognition;
