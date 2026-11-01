import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { signatureView } from '@rswim/domain-dive';
import { PrintButton } from '@/components/print-button';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { fileStore } from '@/lib/dive-files';
import { diveRole, isOffice } from '../../_ui/access';
import { dateShort, hhmm } from '../../_ui/format';
import { di } from '../../_ui/icons';
import { Chip, Panel } from '../../_ui/kit';
import { ReviewForm } from '../../_ui/review-form';
import { SignatureImage } from '../../_ui/signature-image';

/**
 * A signed form exactly as it was signed: the text of that version, the answers, the policy, the signature, when,
 * where and by whom, and the fingerprint of the text. Staff and the diver themself open it (RLS decides); it prints.
 */
export default async function SignedForm({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSurface('dive');
  const role = diveRole(session);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations('dive.forms');
  const s = await withSession((tx) => signatureView(tx, id));
  if (!s) notFound();
  const back = role === 'customer' ? '/dive/me/forms' : `/dive/divers/${s.diverId}`;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-testid="signed-form">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <a href={back} className="text-sm text-[var(--dive-sea)] hover:underline">
          {role === 'customer' ? t('backForms') : t('backDiver')}
        </a>
        <PrintButton label={t('print')} />
      </div>
      <Panel
        title={`${s.title} · ${s.diverName}`}
        icon={di.doc}
        action={
          <Chip tone="muted" icon={false}>
            {t('version', { v: s.version })}
          </Chip>
        }
      >
        <div className="text-sm leading-relaxed whitespace-pre-line">{s.body}</div>
      </Panel>
      {s.questions.length ? (
        <Panel title={t('answers')} icon={di.shield}>
          <ol className="flex flex-col divide-y divide-line text-sm">
            {s.questions.map((q, i) => {
              const a = s.answers[q.code];
              return (
                <li key={q.code} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="me-1.5 text-ink-muted tabular-nums">{i + 1}.</span>
                    {q.he}
                  </span>
                  <Chip tone={a === 'yes' ? (q.flag ? 'nogo' : 'caution') : 'go'}>
                    {a === 'yes' ? t('yes') : t('no')}
                  </Chip>
                </li>
              );
            })}
          </ol>
        </Panel>
      ) : null}
      {s.kind === 'insurance' ? (
        <Panel title={t('policyTitle')} icon={di.shield}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">{t('insurer')}</dt>
            <dd>{s.insurer}</dd>
            <dt className="text-ink-muted">{t('policyNumber')}</dt>
            <dd dir="ltr" className="text-end sm:text-start">
              {s.policyNumber}
            </dd>
            <dt className="text-ink-muted">{t('validUntil')}</dt>
            <dd>{s.validUntil ? dateShort(s.validUntil) : '—'}</dd>
          </dl>
        </Panel>
      ) : null}
      <Panel title={t('signedTitle')} icon={di.pen} testId="signed-meta">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1 text-sm">
            <p>
              <span className="text-ink-muted">{t('signerName')}: </span>
              <strong>{s.signerName}</strong>
            </p>
            <p>
              <span className="text-ink-muted">{t('signedAt')}: </span>
              {dateShort(s.signedAt)} {hhmm(s.signedAt)} · {t(`channel.${s.channel}`)}
              {s.recordedByName ? ` (${s.recordedByName})` : ''}
            </p>
            {s.validUntil && s.kind !== 'insurance' ? (
              <p>
                <span className="text-ink-muted">{t('countsUntil')}: </span>
                {dateShort(s.validUntil)}
              </p>
            ) : null}
            <p className="text-xs break-all text-ink-muted" dir="ltr">
              sha256 {s.textHash}
            </p>
          </div>
          <SignatureImage strokes={s.signature} label={t('signatureOf', { name: s.signerName })} />
        </div>
        {s.fileId ? (
          <a
            href={`/api/dive/files/${s.fileId}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-[var(--dive-sea)] hover:underline print:hidden"
            data-testid="attached-file"
          >
            {di.doc}
            {t('attached')}
          </a>
        ) : null}
      </Panel>
      {s.kind === 'health' ? (
        <Panel title={t('reviewTitle')} icon={di.shield} testId="review">
          {s.review === 'pending' ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">{t('pendingExplain')}</p>
              {isOffice(role) ? (
                <ReviewForm signatureId={s.id} uploads={fileStore() !== null} />
              ) : null}
            </div>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Chip tone={s.review === 'refused' ? 'nogo' : 'go'}>{t(`review.${s.review}`)}</Chip>
              {s.reviewedByName ? `${s.reviewedByName} · ` : ''}
              {s.reviewedAt ? dateShort(s.reviewedAt) : ''}
              {s.reviewNote ? ` · “${s.reviewNote}”` : ''}
            </p>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
