import { describe, expect, it } from 'vitest';
import { addConfirmEditChoiceKeyboard, addConfirmKeyboard } from '../src/bot/addConfirmUi';

describe('add confirm ui', () => {
  it('builds stable confirmation keyboard', () => {
    const keyboard = addConfirmKeyboard('ru');

    expect(keyboard.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data))).toEqual([
      ['add_confirm', 'add_change'],
      ['add_cancel'],
    ]);
  });

  it('builds stable edit choice keyboard', () => {
    const keyboard = addConfirmEditChoiceKeyboard('ru');

    expect(keyboard.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data))).toEqual([
      ['add_change_word', 'add_change_translation'],
      ['add_cancel'],
    ]);
  });
});
