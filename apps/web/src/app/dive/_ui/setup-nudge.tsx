import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { clubSetup } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { di } from './icons';

/**
 * A new club's way into its setup (owner and manager homes): how many first steps are done, until all are. A club
 * that has finished them sees only a quiet link.
 */
export async function SetupNudge() {
  const t = await getTranslations('dive.setup');
  const setup = await withSession((tx) => clubSetup(tx));
  const done = setup.steps.filter((s) => s.done).length;
  const total = setup.steps.length;
  if (done === total) {
    return (
      <Link
        href="/dive/setup"
        className="self-start text-sm font-medium text-[var(--dive-sea)] hover:underline"
        data-testid="to-setup"
      >
        {t('open')}
      </Link>
    );
  }
  return (
    <Link
      href="/dive/setup"
      className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--dive-sea)]/40 bg-[var(--dive-sea)]/10 px-4 py-3"
      data-testid="setup-nudge"
    >
      <span className="flex items-center gap-2">
        <span className="text-[var(--dive-sea)] [&_svg]:size-5">{di.anchor}</span>
        <span>
          <span className="block font-semibold">{t('open')}</span>
          <span className="block text-sm text-ink-muted">{t('openHint', { done, total })}</span>
        </span>
      </span>
      <span className="text-[var(--dive-sea)] [&_svg]:size-4">{di.arrow}</span>
    </Link>
  );
}
