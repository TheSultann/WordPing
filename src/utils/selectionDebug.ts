import { trimEnv } from './env';
export type SelectionDebugScope = 'quiz' | 'news';

const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off']);

const readBooleanEnv = (value: string | undefined): boolean | null => {
  const normalized = trimEnv(value).toLowerCase();
  if (!normalized) return null;
  return !DISABLED_VALUES.has(normalized);
};

const scopedEnvKey = (scope: SelectionDebugScope): string =>
  scope === 'quiz' ? 'QUIZ_SELECTION_DEBUG' : 'NEWS_SELECTION_DEBUG';

export const isSelectionDebugEnabled = (scope: SelectionDebugScope): boolean => {
  const scoped = readBooleanEnv(process.env[scopedEnvKey(scope)]);
  if (scoped !== null) return scoped;

  const global = readBooleanEnv(process.env.SELECTION_DEBUG);
  return global ?? false;
};

export const logSelectionDebug = (
  scope: SelectionDebugScope,
  label: string,
  payload: Record<string, unknown>,
): void => {
  if (!isSelectionDebugEnabled(scope)) return;
  console.log(`[${scope}][selection]`, { label, ...payload });
};
