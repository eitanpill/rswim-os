import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { MESSAGE_STATUSES } from '@rswim/contracts';
import { listMessages, messageCounts } from '@rswim/domain-comms';
import { Badge, Card, EmptyState, PageHeader, cn } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { enumLabel } from '@/lib/options';
import { MessagesTabs, when } from '../tabs';

type Explained = { code: string; params: Record<string, string | number> } | null;

/** Every outbound message, sent, held, failed or blocked, with why (brief §6.12, Phase 5 AC3). */
export default async function MessageLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: raw } = await searchParams;
  const status = (MESSAGE_STATUSES as readonly string[]).includes(raw ?? '') ? raw : undefined;
  const t = await getTranslations();
  const label = await enumLabel();
  const { rows, counts } = await withSession(async (tx) => ({
    rows: await listMessages(tx, { status }),
    counts: await messageCounts(tx),
  }));
  const explain = (e: Explained) => {
    if (!e) return '';
    const p = { ...e.params };
    if (typeof p.until === 'string') p.until = when(p.until);
    return t.has(e.code) ? t(e.code, p) : '';
  };
  return (
    <>
      <PageHeader title={t('comms.log.title')} />
      <MessagesTabs active="log" />
      <nav className="mb-3 flex flex-wrap gap-1 text-sm">
        {[undefined, ...MESSAGE_STATUSES].map((s) => (
          <Link
            key={s ?? 'all'}
            href={s ? `/admin/messages/log?status=${s}` : '/admin/messages/log'}
            aria-current={s === status ? 'page' : undefined}
            className={cn(
              'min-h-tap rounded-xl px-3 py-2',
              s === status && 'bg-brand-50 font-semibold',
            )}
          >
            {s ? label('messageStatus', s) : t('comms.log.all')} (
            {s ? (counts[s] ?? 0) : Object.values(counts).reduce((a, b) => a + b, 0)})
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('comms.log.empty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((m) => (
              <li key={m.id} className="py-3" data-testid="log-row" data-status={m.status}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge
                    tone={
                      m.status === 'sent'
                        ? 'ok'
                        : m.status === 'blocked' || m.status === 'failed'
                          ? 'danger'
                          : m.status === 'held'
                            ? 'warn'
                            : 'neutral'
                    }
                  >
                    {label('messageStatus', m.status)}
                  </Badge>
                  <span className="font-medium">{label('templateKey', m.templateKey)}</span>
                  <span className="text-ink-muted" dir="ltr">
                    {m.toPhoneE164 ?? '—'}
                  </span>
                  <span className="text-ink-muted">{when(m.sentAt ?? m.createdAt)}</span>
                </div>
                {m.body ? (
                  <p className="mt-1 line-clamp-3 text-sm" dir="auto">
                    {m.body}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-ink-muted">
                  {m.status === 'blocked' || m.status === 'held'
                    ? explain(m.explanation as Explained)
                    : null}
                  {m.status === 'failed' ? m.error : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
