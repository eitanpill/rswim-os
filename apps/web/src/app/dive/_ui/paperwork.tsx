import { getTranslations } from 'next-intl/server';
import type { Paperwork, PaperworkItem } from '@rswim/domain-dive';
import { cn } from '@rswim/ui';
import { dateShort } from './format';
import { di } from './icons';
import { btn, Chip, type Tone } from './kit';

export const PAPER_TONE: Record<PaperworkItem['state'], Tone> = {
  ok: 'go',
  warn: 'caution',
  pending: 'info',
  expired: 'nogo',
  missing: 'nogo',
  refused: 'nogo',
};

/**
 * A diver's three forms as cards: where each stands, until when, and the one tap to sign, renew or update it.
 * `signHref` builds the signing page (the diver's own, or the desk's tablet for that diver).
 */
export async function PaperworkCards({
  paperwork,
  signHref,
  canSign = true,
}: {
  paperwork: Paperwork;
  signHref: (kind: PaperworkItem['kind']) => string;
  canSign?: boolean;
}) {
  const t = await getTranslations('dive.forms');
  return (
    <ul className="grid gap-3 md:grid-cols-3" data-testid="paperwork">
      {paperwork.items.map((i) => {
        const due = paperwork.toSign.includes(i.kind);
        return (
          <li
            key={i.kind}
            className={cn(
              'flex flex-col gap-2 rounded-2xl border p-4',
              due
                ? 'border-[color-mix(in_oklch,var(--dive-caution)_50%,var(--line))] bg-[color-mix(in_oklch,var(--dive-caution)_6%,var(--surface-raised))]'
                : 'border-line bg-surface-raised',
            )}
            data-testid={`paper-${i.kind}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="flex items-center gap-2 font-semibold">
                <span className="text-[var(--dive-sea)] [&_svg]:size-5">{di.doc}</span>
                {t(`kind.${i.kind}`)}
              </p>
              <Chip tone={PAPER_TONE[i.state]}>{t(`state.${i.state}`)}</Chip>
            </div>
            <p className="text-sm text-ink-muted">
              {i.state === 'pending'
                ? t('pendingLine')
                : i.state === 'refused'
                  ? t('refusedLine')
                  : i.until
                    ? (i.days ?? 0) < 0
                      ? t('expiredOn', { date: dateShort(i.until) })
                      : t('validUntil2', { date: dateShort(i.until), days: i.days ?? 0 })
                    : t(`missingLine.${i.kind}`)}
            </p>
            {i.kind === 'insurance' && i.insurer ? (
              <p className="text-xs text-ink-muted">
                {i.insurer} · <span dir="ltr">{i.policyNumber}</span>
              </p>
            ) : null}
            {i.reviewNote ? <p className="text-xs text-ink-muted">“{i.reviewNote}”</p> : null}
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              {canSign && i.available ? (
                <a
                  href={signHref(i.kind)}
                  className={due ? btn.primary : btn.ghost}
                  data-testid={`sign-link-${i.kind}`}
                >
                  {i.signatureId ? (i.kind === 'insurance' ? t('update') : t('renew')) : t('sign')}
                </a>
              ) : null}
              {!i.available ? (
                <span className="text-xs text-ink-muted">{t('notPublished')}</span>
              ) : null}
              {i.signatureId ? (
                <a
                  href={`/dive/signed/${i.signatureId}`}
                  className="text-sm text-[var(--dive-sea)] hover:underline"
                >
                  {t('viewSigned')}
                </a>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Every signature a diver gave, newest first, each opening the signed copy. */
export async function SignatureHistory({ paperwork }: { paperwork: Paperwork }) {
  const t = await getTranslations('dive.forms');
  if (paperwork.history.length === 0) return null;
  return (
    <ul className="divide-y divide-line" data-testid="signature-history">
      {paperwork.history.map((h) => (
        <li key={h.id}>
          <a
            href={`/dive/signed/${h.id}`}
            className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-[color-mix(in_oklch,var(--dive-sea)_5%,transparent)]"
          >
            <span className="min-w-0">
              <span className="block font-medium">
                {t(`kind.${h.kind}`)}{' '}
                <span className="text-xs text-ink-muted">{t('version', { v: h.version })}</span>
              </span>
              <span className="block text-xs text-ink-muted">
                {dateShort(h.signedAt)} · {t(`channel.${h.channel}`)}
                {h.validUntil ? ` · ${t('until', { date: dateShort(h.validUntil) })}` : ''}
              </span>
            </span>
            {h.review !== 'none' ? (
              <Chip tone={h.review === 'cleared' ? 'go' : h.review === 'pending' ? 'info' : 'nogo'}>
                {t(`review.${h.review}`)}
              </Chip>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
