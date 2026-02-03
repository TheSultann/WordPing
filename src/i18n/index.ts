export type Lang = 'ru' | 'uz';

import ru from './ru';
import uz from './uz';

const dict: Record<Lang, Record<string, string>> = { ru, uz };

export const t = (lang: Lang, key: string, params: Record<string, string | number> = {}) => {
  const template = dict[lang]?.[key] ?? dict.ru[key] ?? '';
  return template.replace(/\{(\w+)\}/g, (_, k) => (params[k]?.toString() ?? `{${k}}`));
};

export const hasLang = (lang?: string | null): lang is Lang => lang === 'ru' || lang === 'uz';
