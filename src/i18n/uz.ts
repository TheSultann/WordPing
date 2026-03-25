import ru from './ru';

const uz = {
  ...ru,

  chooseLang: '\u{1F310} Tilni tanlang / \u0412\u044B\u0431\u0435\u0440\u0438 \u044F\u0437\u044B\u043A',
  hint:
    '\u{1F44B} Salom!\nInglizcha sozlarni intervalli takrorlash usuli bilan organishga yordam beraman. \u{1F9E0}\n\n\u{1F3AF} Qanday ishlaydi?\n1. Siz soz qoshasiz \u2795\n2. Men kerakli paytda eslataman \u{1F514}\n3. Hard / Good / Easy bilan baholaysiz \u2B50\n\nBoshlaymizmi? \u{1F680}',
  askInterval: '\u23F1 <b>Har necha daqiqada yangi soz yuboray?</b>\n({min}-{max} daqiqa)',
  askGoal: '\u{1F3AF} <b>Bugun nechta soz organamiz?</b>\n({min}-{max})',
  intervalNeedNumber: '\u{1F914} <b>Faqat raqam kiriting.</b>\nMasalan: 10',
  intervalOutOfRange: '\u26A0\uFE0F <b>Mos kelmadi.</b>\n{min} dan {max} daqiqagacha kiriting.',
  intervalSaved: '\u2705 <b>Qabul qilindi!</b> Endi har {value} daqiqada yuboraman.',
  goalNeedNumber: '\u{1F914} <b>Faqat raqam kiriting.</b>\nMasalan: 20',
  goalOutOfRange: '\u26A0\uFE0F <b>{min} dan {max} gacha son kiriting.</b>',
  settingsTip: '\u2699\uFE0F Qolgan sozlamalarni menyudan ham ozgartira olasiz.',

  'onboarding.chooseLang': '\u{1F310} Tilni tanlang / \u0412\u044B\u0431\u0435\u0440\u0438 \u044F\u0437\u044B\u043A',
  'onboarding.hint':
    '\u{1F44B} <b>Tizim oddiy:</b>\nMen soz yuboraman, siz tarjima qilasiz. Keyin Hard / Good / Easy tanlaysiz, men ritmni xotirangizga moslayman.\n\n\u26A1\uFE0F Sozlamalarni istalgan payt ozgartirish mumkin.',
  'onboarding.askInterval':
    '\u23F1 <b>Ritmni sozlaymiz</b>\n\nHozir men har {current} daqiqada yuboryapman.\n\n\u{1F447} Yangi sozlar qaysi oraliqda kelsin? ({min}-{max})',
  'onboarding.intervalNeedNumber': '\u{1F914} <b>Raqam bilan yozing.</b>\nMasalan: 20',
  'onboarding.intervalOutOfRange': '\u26A0\uFE0F <b>{min} dan {max} daqiqagacha kiriting.</b>',
  'onboarding.intervalSaved': '\u2705 <b>Ajoyib!</b> Yangi oraliq: {value} daqiqa.',
  'onboarding.settingsTip': '\u2699\uFE0F Qolgan sozlamalarni keyin menyudan ham ozgartira olasiz.',
  'onboarding.finished':
    '\u2705 <b>Tayyor!</b> Oraliq: {value} daqiqa.\n\nBirinchi inglizcha sozni yuboring \u{1F447}\n\n<tg-spoiler>\u2139\uFE0F Eslatmalar qanday ishlaydi?</tg-spoiler>',

  'btn.back': 'Orqaga',
  'btn.next': 'Tushunarli, boshladik! \u{1F680}',
  'btn.interval': 'Oraliq',
  'btn.cancel': '❌ Bekor qilish',
  'btn.limit': 'Limit',
  'btn.notifyOn': 'Yoniq',
  'btn.notifyOff': 'Ochirilgan',
  'btn.confirmOk': '✅ Tasdiqlash',
  'btn.confirmEdit': '✏️ Tuzatish',
  'btn.editWord': '🇺🇸 So\'z',
  'btn.editTranslation': '🇺🇿 Tarjima',
  'btn.openGuide': 'Eslatmalar qanday ishlaydi?',

  'settings.title': '\u2699\uFE0F <b>Sozlamalaringiz</b>',
  'settings.notificationsOn': '\u{1F514} <b>Bildirishnomalar</b>: Yoniq',
  'settings.notificationsOff': '\u{1F515} <b>Bildirishnomalar</b>: Ochirilgan',
  'settings.intervalLine': '\u23F1 <b>Oraliq</b>: {value} daqiqa',
  'settings.limitLine': '\u{1F6D1} <b>Limit</b>: {value} ta soz/kun',
  'settings.interval.ask':
    '\u23F1 <b>Ritmni yangilang</b>\n\nHozir: har {current} daqiqada.\n\u{1F447} Yangi son kiriting ({min}-{max}):',
  'settings.limit.ask':
    '\u{1F6D1} <b>Kunlik limit</b>\n\nHozir: {current} ta.\n\u{1F447} Yangi limit kiriting ({min}-{max}):',
  'settings.interval.saved': '\u2705 <b>Tayyor!</b> Yangi oraliq: {value} daqiqa.',
  'settings.limit.saved': '\u{1F6D1} <b>Limit yangilandi:</b> {value}',
  'settings.interval.needNumber': '\u{1F914} <b>Raqam kiriting.</b> Masalan: 15',
  'settings.limit.needNumber': '\u{1F914} <b>Son kiriting.</b> Masalan: 30',
  'settings.interval.outRange': '\u26A0\uFE0F <b>{min} dan {max} daqiqagacha.</b>',
  'settings.limit.outRange': '\u26A0\uFE0F <b>{min} dan {max} gacha.</b>',

  'stats.title': '\u{1F4CA} <b>Sizning natijangiz</b>',
  'stats.streak': '\u{1F525} <b>Ketma-ket kunlar</b>: {value}',
  'stats.words': '\u{1F9E0} <b>Yoddagi sozlar</b>: {value}',
  'stats.doneToday': '\u2705 <b>Bugun</b>: {done}/{limit}',
  'stats.due': '\u{1F4CC} <b>Takrorlash navbatida</b>: {value}',

  'add.enter': '\u270D\uFE0F <b>Yangi soz</b>\n\n\u{1F447} Inglizcha sozni yuboring:',
  'add.searchingTranslation': '\u{1F50E} <b>Tarjima qidiryapman...</b>',
  'add.editChoice': '✏️ <b>Nimani tuzatmoqchisiz?</b>',
  'add.manualEnglish': '\u270D\uFE0F <b>Inglizcha so\'z</b>\n\n\u{1F447} So\'zni qayta yozing:',
  'add.manual': '\u270D\uFE0F <b>Tarjima</b>\n\n\u{1F447} Shu sozning tarjimasini yozing:',
  'add.confirmPrompt': 'Hammasi togri bolsa, tasdiqlang.',
  'add.failSave': '\u274C <b>Saqlashda xatolik.</b> Yana bir bor urinib koring.',
  'add.exists': '\u{1F9D0} <b>Bu soz allaqachon bor:</b>\n{pair}',
  'add.suggest': '\u{1F914} <b>Mana bu tarjima mos keladimi?</b>\n\n{pair}\n\nShuni saqlaymizmi?',
  'add.noSuggest': '\u{1F937} <b>Tarjima topilmadi.</b>\n\u{1F447} Tarjimani qolda yozing:',
  'add.needEnglishWord':
    '\u270D\uFE0F <b>Inglizcha variantni topa olmadim.</b>\n\u{1F447} Iltimos, sozni ozi yozing.',
  'add.apiLimitManualTranslation':
    '\u{1F6D1} <b>Bugungi avtotarjima limiti tugadi ({limit}).</b>\n\u{1F447} Tarjimani qolda yozing:',
  'add.apiLimitNeedEnglish':
    '\u{1F6D1} <b>Bugungi avtotarjima limiti tugadi ({limit}).</b>\n\u{1F447} Sozni inglizcha qolda yozing:',
  'add.apiLimitFallbackQuality':
    '\u{1F6D1} <b>Bugungi avtotarjima limiti tugadi ({limit}).</b>\n\u26A0\uFE0F Endi MyMemory orqali davom etaman, sifat pasayishi mumkin.',
  'add.apiLimitReachedNow':
    '\u26A0\uFE0F <b>Bugungi avtotarjima limiti hozir tugadi ({limit}).</b>\nKeyingi sozni qolda sorayman.',
  'add.suspectAutoTranslation':
    '\u26A0\uFE0F <b>Avtotarjima uncha aniq korinmayapti.</b>\n\u{1F447} Togri variantni qolda yozing:',
  'add.dailyLimit': '\u{1F64F} <b>Bugungi limit tugadi: {limit} ta soz.</b>\nErtaga yana davom etamiz.',
  'add.saved': '\u2728 <b>Saqlandi!</b>\n{pair}\n\n\u{1F514} 5 daqiqadan keyin eslataman.',
  'add.duplicate': '\u{1F46F} <b>Bu soz allaqachon mavjud!</b>\n{en}',
  'add.error': '\u274C <b>Xatolik yuz berdi.</b> Keyinroq yana urinib koring.',
  'add.cancelled': '\u{1F44C} <b>Bekor qilindi.</b>',

  'worker.verifyPrompt': '\u{1F9E0} <b>Sozni eslaysizmi?</b>\n\n{phrase}',
  'worker.rememberWord': '\u{1F9E0} <b>Sozni eslaysizmi?</b>',
  'worker.sentencePrompt': '\u{1F4D6} <b>Qaysi soz tushib qolgan?</b>\n\n{sentence}',
  'worker.context.enBold': '\u{1F4D6} <b>Ajratilgan sozni tarjima qiling:</b>\n\n{sentence}',
  'worker.context.enBlank': '\u{1F4D6} <b>Tushib qolgan sozni tarjima qiling:</b>\n\n{sentence}',
  'worker.context.nativeToEnTitle': '\u{1F4D6} <b>Kontekst boyicha inglizcha sozni yozing:</b>',
  'worker.context.nativeToEn': '\u{1F4D6} <b>Kontekst boyicha inglizcha sozni yozing:</b>\n\n{sentence}',
  'worker.direction.enToNative': 'EN -> UZ',
  'worker.direction.nativeToEn': 'UZ -> EN',
  'worker.answerPrompt.native': '\u{1F447} Javobni ozbekcha yozing:',
  'worker.answerPrompt.english': '\u{1F447} Inglizcha javobni yozing:',
  'worker.answerTarget.russian': '\u270D\uFE0F -> ruscha',
  'worker.answerTarget.uzbek': '\u270D\uFE0F -> ozbekcha',
  'worker.answerTarget.english': '\u270D\uFE0F -> inglizcha',
  'worker.hintReveal': '\u{1F4A1} <b>{masked}</b>',
  'worker.hintLimit': 'Ishoralar tugadi (3/3)',
  'worker.hintUnavailable': 'Juda qisqa so‘zlar uchun ishora o‘chirilgan.',
  'worker.answerPrompt': '\u{1F447} Tarjimani yozing:',
  'worker.reminder': '\u23F0 <b>Eslatma!</b> Javob berishni unutmang.',
  'worker.skipped': '\u{1F343} <b>Otib ketdi...</b>\nBunga keyinroq yana qaytamiz!',

  'session.lost': '\u{1F635} <b>Sessiya yoqolib qoldi...</b> Qaytadan boshlaymiz.',
  'answer.correct': '\u{1F48E} <b>Juda yaxshi!</b>',
  'answer.incorrect': '\u{1F47B} <b>Sal xato ketdi.</b>',
  'answer.correctIs': '\u{1F449} Togri javob: <b>{answer}</b>',
  'answer.rate': 'Qanday boldi?',
  'answer.pickGrade': '\u{1F447} <b>Bahoni tanlang:</b>',

  'grade.noActive': '\u{1F4A4} Hozir faol topshiriq yoq.',
  'grade.saved': '\u{1F44D} Esda qoldi',
  'grade.accepted': '\u{1F680} <b>Qabul qilindi!</b> Davom etamiz.',
  'grade.progress': 'Bugun: <b>{done}/{limit}</b> · Qoldi {left}',
  'grade.limitReached': 'Bugungi limit bajarildi \u2705',
  'reviewFlowHint': 'ℹ️ Sozlamalarda bosqichlar va intervallar qanday ishlashini tez ko\'rish mumkin.',

  'notify.toggled': '\u{1F44C} <b>Holat ozgartirildi.</b>',
} as const;

export default uz;
