import { dayInfo, hebrewDate, lessonDay, todayInIsrael } from '@rswim/calendar';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { Badge } from '@rswim/ui';

/** Gregorian + Hebrew date, today's holiday and whether regular lessons run (default calendar policy). */
export async function TodayLine() {
  const locale = (await getLocale()) as 'he' | 'en';
  const format = await getFormatter();
  const t = await getTranslations('calendar');
  const today = todayInIsrael();
  const info = dayInfo(today);
  const decision = lessonDay(today);
  return (
    <div className="flex flex-wrap items-center gap-2 text-ink-muted" data-testid="today-line">
      <span>
        {format.dateTime(new Date(`${today}T12:00:00`), {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      </span>
      <span aria-hidden>·</span>
      <span>{hebrewDate(today, locale)}</span>
      {info.holidays.map((h) => (
        <Badge key={h.en}>{locale === 'he' ? h.he : h.en}</Badge>
      ))}
      {!decision.lessons ? <Badge tone="warn">{t('noLessons')}</Badge> : null}
    </div>
  );
}
