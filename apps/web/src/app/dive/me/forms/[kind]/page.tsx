import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DIVE_FORM_KINDS, type DiveFormKind } from '@rswim/contracts';
import { currentForm, diverName, myDiverId, todayIL } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { fileStore } from '@/lib/dive-files';
import { requireDivePage } from '../../../_ui/access';
import { FormSign } from '../../../_ui/form-sign';
import { Empty, Hero, Panel } from '../../../_ui/kit';

/** The diver reads one of the club's forms and signs it on their phone. */
export default async function SignMyForm({ params }: { params: Promise<{ kind: string }> }) {
  await requireDivePage('me');
  const { kind } = await params;
  if (!(DIVE_FORM_KINDS as readonly string[]).includes(kind)) notFound();
  const t = await getTranslations('dive.forms');
  const data = await withSession(async (tx) => {
    const id = await myDiverId(tx);
    if (!id) return null;
    const [template, name, today] = await Promise.all([
      currentForm(tx, kind as DiveFormKind),
      diverName(tx, id),
      todayIL(tx),
    ]);
    return { template, name: name ?? '', today };
  });
  if (!data) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-testid="sign-page">
      <a href="/dive/me/forms" className="text-sm text-[var(--dive-sea)] hover:underline">
        {t('backForms')}
      </a>
      <Hero kicker={t('kicker')} title={t(`kind.${kind}`)} sub={t(`signSub.${kind}`)} />
      {data.template ? (
        <FormSign
          template={data.template}
          signerName={data.name}
          today={data.today}
          uploads={fileStore() !== null}
        />
      ) : (
        <Panel>
          <Empty>{t('notPublished')}</Empty>
        </Panel>
      )}
    </div>
  );
}
