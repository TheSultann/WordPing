import { describe, expect, it } from 'vitest';
import {
  ADD_CANCEL_CALLBACK,
  ADD_CHANGE_CALLBACK,
  ADD_CHANGE_TRANSLATION_CALLBACK,
  ADD_CHANGE_WORD_CALLBACK,
  ADD_CONFIRM_CALLBACK,
  isAddConfirmCallbackData,
  parseAddConfirmCallbackData,
} from '../src/bot/addConfirmCallbackData';

describe('add confirm callback data', () => {
  it('keeps callback values stable', () => {
    expect(ADD_CONFIRM_CALLBACK).toBe('add_confirm');
    expect(ADD_CHANGE_CALLBACK).toBe('add_change');
    expect(ADD_CHANGE_WORD_CALLBACK).toBe('add_change_word');
    expect(ADD_CHANGE_TRANSLATION_CALLBACK).toBe('add_change_translation');
    expect(ADD_CANCEL_CALLBACK).toBe('add_cancel');
  });

  it('parses supported callback actions', () => {
    expect(parseAddConfirmCallbackData(ADD_CONFIRM_CALLBACK)).toBe('confirm');
    expect(parseAddConfirmCallbackData(ADD_CHANGE_CALLBACK)).toBe('change');
    expect(parseAddConfirmCallbackData(ADD_CHANGE_WORD_CALLBACK)).toBe('changeWord');
    expect(parseAddConfirmCallbackData(ADD_CHANGE_TRANSLATION_CALLBACK)).toBe('changeTranslation');
    expect(parseAddConfirmCallbackData(ADD_CANCEL_CALLBACK)).toBe('cancel');
  });

  it('rejects unsupported callback data', () => {
    expect(isAddConfirmCallbackData(ADD_CONFIRM_CALLBACK)).toBe(true);
    expect(isAddConfirmCallbackData(ADD_CHANGE_WORD_CALLBACK)).toBe(true);
    expect(isAddConfirmCallbackData(ADD_CHANGE_TRANSLATION_CALLBACK)).toBe(true);
    expect(isAddConfirmCallbackData('add_other')).toBe(false);
    expect(parseAddConfirmCallbackData('add_other')).toBeNull();
  });
});
