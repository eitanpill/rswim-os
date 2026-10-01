export const LOCALES = ['he', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'he';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);
export const dirFor = (l: Locale) => (l === 'he' ? 'rtl' : 'ltr');
