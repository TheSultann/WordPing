import { describe, expect, it } from 'vitest';
import { getSpeechRecognitionPolicy } from '../web/src/hooks/useSpeechRecognition';

describe('getSpeechRecognitionPolicy', () => {
  it('uses direct manual speech start in Telegram Android WebView', () => {
    const policy = getSpeechRecognitionPolicy({
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Telegram',
      hasTelegramWebApp: true,
    });

    expect(policy.requiresManualStart).toBe(true);
    expect(policy.useMediaPreflight).toBe(false);
    expect(policy.autoRestart).toBe(false);
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
