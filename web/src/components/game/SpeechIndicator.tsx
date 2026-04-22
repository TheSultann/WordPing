import { Mic, TriangleAlert } from 'lucide-react';
import type { UseSpeechRecognitionReturn } from '../../hooks/useSpeechRecognition';

type SpeechIndicatorProps = {
  status: UseSpeechRecognitionReturn['status'];
  label: string;
  isIOS: boolean;
  isListening: boolean;
  hasError: boolean;
  disabled?: boolean;
  actionLabel?: string | null;
  onTapStart?: () => void;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
};

const SpeechIndicator = ({
  status,
  label,
  isIOS,
  isListening,
  hasError,
  disabled = false,
  actionLabel,
  onTapStart,
  onHoldStart,
  onHoldEnd,
}: SpeechIndicatorProps) => {
  const toneClass = hasError
    ? 'is-error'
    : status === 'processing'
      ? 'is-processing'
      : status === 'listening'
        ? 'is-listening'
        : '';

  const shouldShowTapButton = !isIOS && actionLabel && onTapStart;
  const shouldShowHoldButton = isIOS && actionLabel && onHoldStart && onHoldEnd;
  const showStatusDot = !hasError && (status === 'listening' || status === 'processing');
  const displayLabel = (shouldShowTapButton || shouldShowHoldButton)
    ? actionLabel
    : label;

  const iconNode = hasError
    ? <TriangleAlert size={16} strokeWidth={2.3} />
    : showStatusDot
      ? <span className="speech-indicator__status-dot" aria-hidden="true" />
      : <Mic size={16} strokeWidth={2.3} />;

  const iconClassName = `speech-indicator__icon${showStatusDot ? ' speech-indicator__icon--dot' : ''}`;

  if (shouldShowTapButton) {
    return (
      <button
        type="button"
        className={`speech-indicator speech-indicator--action ${toneClass} ${isListening ? 'is-active' : ''}`}
        disabled={disabled}
        onClick={onTapStart}
      >
        <span className={iconClassName} aria-hidden="true">
          {iconNode}
        </span>
        <span className="speech-indicator__label">{displayLabel}</span>
      </button>
    );
  }

  if (shouldShowHoldButton) {
    return (
      <button
        type="button"
        className={`speech-indicator speech-indicator--action ${toneClass} ${isListening ? 'is-active' : ''}`}
        disabled={disabled}
        onPointerDown={onHoldStart}
        onPointerUp={onHoldEnd}
        onPointerCancel={onHoldEnd}
        onPointerLeave={onHoldEnd}
      >
        <span className={iconClassName} aria-hidden="true">
          {iconNode}
        </span>
        <span className="speech-indicator__label">{displayLabel}</span>
      </button>
    );
  }

  return (
    <div className={`speech-indicator ${toneClass}`}>
      <span className={iconClassName} aria-hidden="true">
        {iconNode}
      </span>
      <span className="speech-indicator__label">{displayLabel}</span>
    </div>
  );
};

export default SpeechIndicator;
