export type AddConfirmAction = 'confirm' | 'change' | 'changeWord' | 'changeTranslation' | 'cancel';

export const ADD_CONFIRM_CALLBACK = 'add_confirm';
export const ADD_CHANGE_CALLBACK = 'add_change';
export const ADD_CHANGE_WORD_CALLBACK = 'add_change_word';
export const ADD_CHANGE_TRANSLATION_CALLBACK = 'add_change_translation';
export const ADD_CANCEL_CALLBACK = 'add_cancel';

export const isAddConfirmCallbackData = (data: string): boolean =>
  data === ADD_CONFIRM_CALLBACK ||
  data === ADD_CHANGE_CALLBACK ||
  data === ADD_CHANGE_WORD_CALLBACK ||
  data === ADD_CHANGE_TRANSLATION_CALLBACK ||
  data === ADD_CANCEL_CALLBACK;

export const parseAddConfirmCallbackData = (data: string): AddConfirmAction | null => {
  switch (data) {
    case ADD_CONFIRM_CALLBACK:
      return 'confirm';
    case ADD_CHANGE_CALLBACK:
      return 'change';
    case ADD_CHANGE_WORD_CALLBACK:
      return 'changeWord';
    case ADD_CHANGE_TRANSLATION_CALLBACK:
      return 'changeTranslation';
    case ADD_CANCEL_CALLBACK:
      return 'cancel';
    default:
      return null;
  }
};
