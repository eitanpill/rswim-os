import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { demoProfile, dressMessages } from '@rswim/db/demo-profiles';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from './config';

// The live demo can be dressed for another kind of school (RSWIM_DEMO_PROFILE); the wording follows.
const dressed = new Map<string, unknown>();
async function messagesFor(locale: 'he' | 'en') {
  const base = (await import(`../../messages/${locale}.json`)).default;
  if (process.env.RSWIM_DEMO_MODE !== '1') return base;
  if (!dressed.has(locale)) dressed.set(locale, dressMessages(base, demoProfile().uiWords[locale]));
  return dressed.get(locale) as typeof base;
}

export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
  return {
    locale,
    timeZone: 'Asia/Jerusalem',
    messages: await messagesFor(locale),
  };
});
