import { describe, expect, it } from 'vitest';
import { getSpeechRecognitionPolicy } from '../web/src/hooks/useSpeechRecognition';

describe('getSpeechRecognitionPolicy', () => {
  it('uses media preflight and auto restart in Telegram Android WebView', () => {
    const policy = getSpeechRecognitionPolicy({
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Telegram',
      hasTelegramWebApp: true,
    });

    // Telegram WebApp on Android now behaves like a regular browser:
    // media preflight keeps the mic stream alive, auto-restart ensures
    // seamless recognition loop without mic disconnects.
    expect(policy.requiresManualStart).toBe(false);
    expect(policy.useMediaPreflight).toBe(true);
    expect(policy.autoRestart).toBe(true);
  });

  it('allows media preflight and auto restart on desktop Chrome', () => {
    const policy = getSpeechRecognitionPolicy({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
      hasTelegramWebApp: false,
    });

    expect(policy.requiresManualStart).toBe(false);
    expect(policy.useMediaPreflight).toBe(true);
    expect(policy.autoRestart).toBe(true);
  });
});
