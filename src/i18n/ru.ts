const ru = {
  // Aliases for legacy keys used in code
  chooseLang: '🌐 Выбери язык / Tilni tanlang:',
  hint:
    '👋 <b>Привет!</b>\n\nЯ помогу тебе прокачать английский методом интервальных повторений. 🧠\n\n🎯 <b>Как это работает?</b>\n1. Ты кидаешь мне слова ➕\n2. Я вовремя о них напоминаю 🔔\n3. Ты оцениваешь, насколько легко было вспомнить ⭐\n\nПогнали? 🚀',
  askInterval:
    '⏱ <b>Твой ритм</b>\n\nКак часто присылать слова?\n\n👇 Напиши число минут (от {min} до {max}).\n<i>Например: 15, 30 или 60.</i>',
  askGoal:
    '🎯 <b>Цель на день</b>\n\nСколько слов хочешь учить в день?\n\n👇 Напиши число (от {min} до {max}).',
  intervalNeedNumber: '🤔 <b>Это не число.</b>\nНапиши просто цифрами, например: 10',
  intervalOutOfRange: '⚠️ <b>Не подходит.</b>\nНужно время от {min} до {max} минут.',
  intervalSaved: '✅ <b>Принято!</b> Буду писать раз в {value} мин.',
  goalNeedNumber: '🤔 <b>Это не число.</b>\nНапиши, сколько слов в день хочешь учить, например: 20',
  goalOutOfRange: '⚠️ <b>Нужно число от {min} до {max}.</b>\nПопробуй другое значение.',
  settingsTip: '⚙️ Больше настроек — в меню.',

  'onboarding.chooseLang': '🌐 Выбери язык / Tilni tanlang:',
  'onboarding.hint':
    '👋 <b>Суть проста:</b>\nЯ шлю слово — ты переводишь. Потом жмешь Hard/Good/Easy, и я подстраиваюсь под твою память.\n\n⚡️ Настройки можно поменять в любой момент.',
  'onboarding.askInterval':
    '⏱ <b>Настроим частоту</b>\n\nСейчас я пишу раз в {current} мин.\n\n👇 Напиши, через сколько минут присылать новые слова (от {min} до {max}):',
  'onboarding.intervalNeedNumber': '🤔 <b>Цифрами, пожалуйста.</b>\nНапример: 20',
  'onboarding.intervalOutOfRange': '⚠️ <b>От {min} до {max} минут.</b>\nПопробуй другое число.',
  'onboarding.intervalSaved': '✅ <b>Отлично!</b> Интервал: {value} мин.',
  'onboarding.settingsTip': '⚙️ Остальное настроишь потом в меню.',
  'onboarding.finished': '🚀 <b>Ты в игре!</b>\nИнтервал: {value} мин.\n\n👇 <b>Отправь мне первое слово</b> на английском, и начнем обучение.',
  'onboarding.menuTip': '⚙️ <b>Меню настроек</b> появилось внизу.',

  'btn.settings': '⚙️ Настройки',
  'btn.stats': '📊 Прогресс',
  'btn.back': '⬅️ Назад',
  'btn.next': 'Понятно, погнали! 🚀',
  'btn.interval': '⏱ Интервал',
  'btn.cancel': '❌ Отмена',
  'btn.limit': '🛑 Лимит',
  'btn.notifyOn': '🔔 Включены',
  'btn.notifyOff': '🔕 Выключены',
  'btn.confirmOk': '✅ Всё верно',
  'btn.confirmEdit': '✏️ Исправить',

  'settings.title': '⚙️ <b>Твои настройки</b>',
  'settings.notificationsOn': '🔔 <b>Уведомления</b>: Работают',
  'settings.notificationsOff': '🔕 <b>Уведомления</b>: Спят',
  'settings.intervalLine': '⏱ <b>Интервал</b>: {value} мин',
  'settings.limitLine': '🛑 <b>Лимит</b>: {value} слов/день',

  'settings.interval.ask':
    '⏱ <b>Настрой ритм</b>\n\nСейчас: раз в {current} мин.\n👇 Напиши новое число (от {min} до {max}):',
  'settings.limit.ask':
    '🛑 <b>Лимит уведомлений</b>\n\nСейчас: {current} в день.\n👇 Введи новый лимит (от {min} до {max}):',
  'settings.interval.saved': '✅ <b>Готово!</b> Новый ритм: {value} мин.',
  'settings.limit.saved': '🛑 <b>Лимит обновлен:</b> {value} уведомлений.',
  'settings.interval.needNumber': '🤔 <b>Нужно число.</b> Например: 15',
  'settings.limit.needNumber': '🤔 <b>Введи число.</b> Например: 30',
  'settings.interval.outRange': '⚠️ <b>От {min} до {max} минут.</b>',
  'settings.limit.outRange': '⚠️ <b>От {min} до {max}.</b>',

  'stats.title': '📊 <b>Твой прогресс</b>',
  'stats.streak': '🔥 <b>Стрик</b>: {value} дн.',
  'stats.words': '🧠 <b>Слов в памяти</b>: {value}',
  'stats.doneToday': '✅ <b>Сегодня</b>: {done} из {limit}',
  'stats.due': '📌 <b>Ждут повтора</b>: {value}',

  'add.enter': '✍️ <b>Новое слово</b>\n\n👇 Пиши на английском:',
  'add.manual': '✍️ <b>Перевод</b>\n\n👇 Напиши перевод для этого слова:',
  'add.confirmPrompt': 'Подтверди, если всё ок.',
  'add.failSave': '❌ <b>Упс, ошибка сохранения.</b> Попробуй еще раз.',

  'add.exists': '🧐 <b>Уже было:</b>\n🇺🇸 <b>{en}</b> — 🇷🇺 {ru}',
  'add.suggest': '🤔 <b>Как тебе такой перевод?</b>\n\n🇷🇺 {tr}\n\nБерем?',
  'add.noSuggest': '🤷‍♂️ <b>Не знаю перевода.</b>\n👇 Научи меня! Напиши перевод:',
  'add.dailyLimit': '🙏 <b>Сори, сегодня лимит: {limit} слов.</b>\nЗавтра сможешь добавить еще.',
  'add.saved': '✨ <b>Сохранил!</b>\n🇺🇸 <b>{en}</b> — 🇷🇺 {ru}\n\n🔔 Напомню через 5 минут.',
  'add.duplicate': '👯‍♂️ <b>Такое уже есть!</b>\nГлянь в /settings, если хочешь изменить.',
  'add.error': '❌ <b>Сбой системы.</b> Попробуй позже.',
  'add.cancelled': '👌 <b>Отменил.</b>',

  'worker.verifyPrompt': '🧠 <b>Вспомнишь слово?</b>\n\n🇬🇧 {phrase}',
  'worker.answerPrompt': '👇 Пиши перевод:',
  'worker.reminder': '⏰ <b>Тик-так!</b> Не забывай отвечать.',
  'worker.skipped': '🍃 <b>Улетело...</b>\nВернусь с ним позже!',

  'session.lost': '😵 <b>Я потерял нить...</b> Давай начнем сначала.',
  'answer.correct': '💎 <b>Блестяще!</b>',
  'answer.incorrect': '👻 <b>Мимо!</b>',
  'answer.correctIs': '👉 Правильно: <b>{answer}</b>',
  'answer.rate': 'Как пошло?',
  'answer.pickGrade': '👇 <b>Как оно?</b>',

  'grade.noActive': '💤 Нет активного задания.',
  'grade.saved': '👍 Запомнил',
  'grade.accepted': '🚀 <b>Принято!</b> Едем дальше.',
  'grade.progress': 'Сегодня: <b>{done}/{limit}</b> · Осталось {left}',
  'grade.limitReached': 'Сегодняшний лимит выполнен ✅',

  'notify.toggled': '👌 <b>Переключил.</b>',
};

export default ru;
