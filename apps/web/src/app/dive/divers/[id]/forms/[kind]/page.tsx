import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DIVE_FORM_KINDS, type DiveFormKind } from '@rswim/contracts';
import { currentForm, diverName, todayIL } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { fileStore } from '@/lib/dive-files';
import { isOffice, requireDivePage } from '../../../../_ui/access';
import { FormSign } from '../../../../_ui/form-sign';
import { Empty, Hero, Panel } from '../../../../_ui/kit';

/** The desk hands the tablet to the diver: they read the form and sign it with their own hand. */
export default async function DeskSign({
  params,
}: {
  params: Promise<{ id: string; kind: string }>;
}) {
  const { role } = await requireDivePage('divers');
  const { id, kind } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !(DIVE_FORM_KINDS as readonly string[]).includes(kind))
    notFound();
  if (!isOffice(role)) redirect(`/dive/divers/${id}`);
  const t = await getTranslations('dive.forms');
  const data = await withSession((tx) =>
    Promise.all([currentForm(tx, kind as DiveFormKind), diverName(tx, id), todayIL(tx)]),
  );
  const [template, name, today] = data;
  if (!name) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-testid="desk-sign">
      <a href={`/dive/divers/${id}`} className="text-sm text-[var(--dive-sea)] hover:underline">
        {t('backDiver')}
      </a>
      <Hero
        kicker={t('deskKicker')}
        title={`${t(`kind.${kind}`)} · ${name}`}
        sub={t('deskSub', { name })}
      />
      {template ? (
        <FormSign
          template={template}
          diverId={id}
          signerName={name}
          today={today}
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
