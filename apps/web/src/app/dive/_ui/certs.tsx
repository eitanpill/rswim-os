import { getTranslations } from 'next-intl/server';
import { DIVE_CERT_AGENCIES, DIVE_LEVELS } from '@rswim/contracts';
import type { CertCard, PendingCert } from '@rswim/domain-dive';
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton } from '@/components/form';
import { reviewCertAction, submitCertAction } from '../signup-actions';
import { dateShort } from './format';
import { di } from './icons';
import { Chip, type Tone } from './kit';

const STATUS_TONE: Record<CertCard['status'], Tone> = {
  pending: 'caution',
  verified: 'go',
  rejected: 'nogo',
};

/**
 * Adds a certification card: the diver on their phone (waits for the club), or the desk for the diver it names (and
 * may mark it verified when it saw the card).
 */
export async function CertForm({ diverId, uploads }: { diverId?: string; uploads: boolean }) {
  const t = await getTranslations('dive.certs');
  const tLevel = await getTranslations('dive.level');
  return (
    <ActionForm action={submitCertAction} resetOnSuccess testId="cert-form">
      {diverId ? <input type="hidden" name="diverId" value={diverId} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="agency"
          label={t('agency')}
          options={DIVE_CERT_AGENCIES.map((a) => ({ value: a, label: t(`agencies.${a}`) }))}
        />
        <SelectField
          name="level"
          label={t('level')}
          hint={t('levelHint')}
          defaultValue="2"
          options={DIVE_LEVELS.filter((l) => l > 0).map((l) => ({
            value: String(l),
            label: tLevel(String(l)),
          }))}
        />
      </div>
      <Field name="name" label={t('name')} placeholder="Molchanovs Wave 1 / AIDA 2" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="number" label={t('number')} dir="ltr" />
        <Field name="issuedOn" label={t('issuedOn')} type="date" dir="ltr" />
      </div>
      {uploads ? (
        <Field
          name="document"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment"
          label={t('photo')}
          hint={t('photoHint')}
          className="py-2 text-sm"
        />
      ) : null}
      {diverId ? <CheckboxField name="verified" label={t('sawIt')} /> : null}
      <div>
        <SubmitButton data-testid="cert-submit">{diverId ? t('record') : t('send')}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** A diver's cards, newest first, with where each stands. */
export async function CertList({ certs }: { certs: CertCard[] }) {
  const t = await getTranslations('dive.certs');
  const tLevel = await getTranslations('dive.level');
  return (
    <ul className="divide-y divide-line" data-testid="cert-list">
      {certs.map((c) => (
        <li
          key={c.id}
          className="flex items-start justify-between gap-3 px-4 py-3"
          data-testid="cert"
        >
          <div className="min-w-0">
            <p className="font-medium">{c.name}</p>
            <p className="text-xs text-ink-muted">
              {t(`agencies.${c.agency}`)} · {tLevel(String(c.level))}
              {c.number ? ` · ${c.number}` : ''}
              {c.issuedOn ? ` · ${t('issued', { date: dateShort(c.issuedOn) })}` : ''}
            </p>
            {c.reviewNote ? <p className="mt-1 text-xs">{c.reviewNote}</p> : null}
          </div>
          <span className="flex shrink-0 items-center gap-2">
            {c.fileId ? (
              <a
                href={`/api/dive/files/${c.fileId}`}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--dive-sea)] [&_svg]:size-4"
                title={t('viewPhoto')}
                aria-label={t('viewPhoto')}
              >
                {di.eye}
              </a>
            ) : null}
            <Chip tone={STATUS_TONE[c.status]}>{t(`status.${c.status}`)}</Chip>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One card waiting for the desk: who, what they claim, the photo, and verify (correcting the level) or reject. */
export async function CertReview({ cert }: { cert: PendingCert }) {
  const t = await getTranslations('dive.certs');
  const tLevel = await getTranslations('dive.level');
  return (
    <ActionForm action={reviewCertAction} testId={`cert-review-${cert.id}`}>
      <input type="hidden" name="certId" value={cert.id} />
      <SelectField
        name="level"
        label={t('levelOnFile')}
        hint={t('levelNow', { level: tLevel(String(cert.currentLevel)) })}
        defaultValue={String(cert.level)}
        options={DIVE_LEVELS.map((l) => ({ value: String(l), label: tLevel(String(l)) }))}
      />
      <Field name="note" label={t('reviewNote')} placeholder={t('reviewNotePlaceholder')} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="verified" data-testid="cert-verify">
          {t('verify')}
        </SubmitButton>
        <SubmitButton
          name="decision"
          value="rejected"
          variant="secondary"
          data-testid="cert-reject"
        >
          {t('reject')}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
