import { getTranslations } from 'next-intl/server';
import { diverPaperwork, myDiverId } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { requireDivePage } from '../../_ui/access';
import { di } from '../../_ui/icons';
import { Empty, Hero, Panel } from '../../_ui/kit';
import { PaperworkCards, SignatureHistory } from '../../_ui/paperwork';

/** The diver's paperwork: health declaration, waiver and insurance, where each stands, and every signature given. */
export default async function MyForms({
  searchParams,
}: {
  searchParams: Promise<{ signed?: string; pending?: string }>;
}) {
  await requireDivePage('me');
  const sp = await searchParams;
  const t = await getTranslations('dive.forms');
  const paperwork = await withSession(async (tx) => {
    const id = await myDiverId(tx);
    return id ? diverPaperwork(tx, id) : null;
  });
  if (!paperwork)
    return (
      <Panel>
        <Empty>{t('noDiver')}</Empty>
      </Panel>
    );
  return (
    <div className="flex flex-col gap-5" data-testid="my-forms">
      <a href="/dive/me" className="text-sm text-[var(--dive-sea)] hover:underline">
        {t('backHome')}
      </a>
      <Hero kicker={t('kicker')} title={t('myTitle')} sub={t('mySub')} />
      {sp.signed ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-2xl bg-[color-mix(in_oklch,var(--dive-go)_12%,transparent)] px-4 py-3 font-semibold text-[color-mix(in_oklch,var(--dive-go)_70%,var(--ink))] [&_svg]:size-5"
          data-testid="signed-banner"
        >
          {di.check}
          {sp.pending ? t('signedPending') : t('signedBanner')}
        </p>
      ) : null}
      <PaperworkCards paperwork={paperwork} signHref={(k) => `/dive/me/forms/${k}`} />
      <Panel title={t('history')} icon={di.doc} flush>
        {paperwork.history.length ? (
          <SignatureHistory paperwork={paperwork} />
        ) : (
          <Empty>{t('noHistory')}</Empty>
        )}
      </Panel>
    </div>
  );
}
