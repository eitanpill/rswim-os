import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { displayPhoneIL } from '@rswim/contracts';
import { isDomainError } from '@rswim/domain-core';
import {
  botPerformance,
  CHAT_FILTERS,
  getChat,
  listChats,
  type ChatFilter,
  type ChatRow,
} from '@rswim/domain-comms';
import { Badge, buttonVariants, Card, cn, EmptyState, StatTile } from '@rswim/ui';
import { ActionButton, ActionForm, SubmitButton, TextareaField } from '@/components/form';
import { withSession } from '@/lib/db';
import { releaseChatAction, replyToChatAction, takeOverChatAction } from './actions';

/** Where the conversations live: a swim school's messages, or a freediving club. */
export type ChatsBase = '/admin/messages/chats' | '/dive/chats';
type T = Awaited<ReturnType<typeof getTranslations>>;

const TIME = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function chatFilter(raw: string | undefined): ChatFilter {
  return CHAT_FILTERS.find((f) => f === raw) ?? 'all';
}

/** A phone as the address bar carries it: digits only. */
const slug = (phone: string) => phone.replace(/\D/g, '');

function who(t: T, c: Pick<ChatRow, 'name' | 'kind' | 'phone'>): string {
  return c.name ?? (c.kind === 'staff' ? t('staff') : displayPhoneIL(c.phone));
}

/** The bot's month in four numbers, then every conversation with who holds it. */
export async function ChatsList({ base, filter }: { base: ChatsBase; filter: ChatFilter }) {
  const t = await getTranslations('chats');
  const { perf, chats } = await withSession(async (tx) => ({
    perf: await botPerformance(tx),
    chats: await listChats(tx, { filter }),
  }));
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t('perf.title')} data-testid="bot-performance">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile
            label={t('perf.alone')}
            value={perf.alonePercent === null ? '—' : `${perf.alonePercent}%`}
            hint={t('perf.aloneHint', { answered: perf.answered, total: perf.total })}
            tone="ok"
          />
          <StatTile
            label={t('perf.handedOff')}
            value={perf.handedOff}
            hint={
              perf.reasons[0]
                ? t('perf.topReason', { reason: t(`reason.${perf.reasons[0].reason}`) })
                : t('perf.noHandoffs')
            }
          />
          <StatTile
            label={t('perf.waiting')}
            value={perf.waiting}
            hint={t('perf.waitingHint')}
            tone={perf.waiting > 0 ? 'warn' : 'brand'}
          />
          <StatTile label={t('perf.held')} value={perf.held} hint={t('perf.heldHint')} />
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {t('perf.period')}
          {perf.bad > 0 ? ` · ${t('perf.bad', { n: perf.bad })}` : ''}
        </p>
      </section>

      <nav aria-label={t('filters')} className="flex flex-wrap gap-2 text-sm">
        {CHAT_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'all' ? base : `${base}?show=${f}`}
            aria-current={f === filter ? 'page' : undefined}
            className={cn(
              'min-h-tap rounded-xl px-3 py-2',
              f === filter && 'bg-brand-50 font-semibold',
            )}
          >
            {t(`filter.${f}`)}
          </Link>
        ))}
      </nav>

      {chats.length === 0 ? (
        <Card>
          <EmptyState title={t(filter === 'all' ? 'empty' : 'emptyFilter')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="chats">
          {chats.map((c) => (
            <li key={c.phone}>
              <Link
                href={`${base}/${slug(c.phone)}`}
                data-testid="chat"
                className="block rounded-2xl border border-line bg-surface-raised p-3 hover:border-brand-500"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{who(t, c)}</span>
                  <Badge>{t(`kind.${c.kind}`)}</Badge>
                  {c.held ? <Badge tone="warn">{t('heldBadge')}</Badge> : null}
                  {c.open > 0 ? (
                    <Badge tone="warn">{t('waitingBadge', { n: c.open })}</Badge>
                  ) : null}
                  {!c.held && c.bot === 'answered' ? (
                    <Badge tone="ok">{t('botAnswered')}</Badge>
                  ) : null}
                  <span className="ms-auto text-xs text-ink-muted">{TIME.format(c.lastAt)}</span>
                </span>
                <span className="mt-1 line-clamp-2 block text-sm text-ink-muted" dir="auto">
                  {c.lastDirection === 'out' ? `${t('us')}: ` : ''}
                  {c.lastBody}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One conversation: the whole thread, who holds it, and a reply box. */
export async function ChatView({ base, digits }: { base: ChatsBase; digits: string }) {
  if (!/^\d{8,15}$/.test(digits)) notFound();
  const phone = `+${digits}`;
  const t = await getTranslations('chats');
  const chat = await withSession((tx) => getChat(tx, phone)).catch((e: unknown) => {
    if (isDomainError(e)) notFound();
    throw e;
  });
  const held = chat.heldSince !== null;
  return (
    <div className="flex flex-col gap-4" data-testid="chat-view">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={base} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          {t('back')}
        </Link>
        <h2 className="text-lg font-bold">{who(t, chat)}</h2>
        <Badge>{t(`kind.${chat.kind}`)}</Badge>
        {chat.name ? (
          <span dir="ltr" className="text-sm tabular-nums text-ink-muted">
            {displayPhoneIL(chat.phone)}
          </span>
        ) : null}
        {chat.householdId ? (
          <Link
            href={`/admin/families/${chat.householdId}`}
            className="text-sm text-brand-700 underline"
          >
            {t('familyCard')}
          </Link>
        ) : null}
      </div>

      <Card className={cn(held && 'border-warn')} data-testid="chat-hold">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{held ? t('hold.on') : t('hold.off')}</p>
            <p className="text-sm text-ink-muted">
              {held
                ? t('hold.onHint', { when: TIME.format(chat.heldSince as Date) })
                : t('hold.offHint')}
            </p>
          </div>
          {held ? (
            <ActionButton
              action={releaseChatAction}
              fields={{ phone: chat.phone }}
              variant="secondary"
              data-testid="chat-release"
            >
              {t('hold.release')}
            </ActionButton>
          ) : (
            <ActionButton
              action={takeOverChatAction}
              fields={{ phone: chat.phone }}
              data-testid="chat-take"
            >
              {t('hold.take')}
            </ActionButton>
          )}
        </div>
      </Card>

      <Card>
        <ol className="mb-3 flex flex-col gap-2" data-testid="chat-lines">
          {chat.lines.map((m) => (
            <li
              key={`${m.direction}-${m.id}`}
              data-testid={`chat-line-${m.direction}`}
              className={
                m.direction === 'in'
                  ? 'me-8 rounded-2xl rounded-ss-sm bg-surface p-3 text-sm ring-1 ring-line/60'
                  : 'ms-8 rounded-2xl rounded-se-sm bg-brand-50 p-3 text-sm dark:bg-surface-raised'
              }
            >
              <p className="whitespace-pre-wrap" dir="auto">
                {m.body}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {TIME.format(m.at)}
                {m.direction === 'out' ? ` · ${t(`by.${m.by}`)}` : ''}
                {m.direction === 'out' && m.status ? ` · ${t(`status.${m.status}`)}` : ''}
              </p>
            </li>
          ))}
        </ol>
        <ActionForm action={replyToChatAction} resetOnSuccess testId="chat-reply">
          <input type="hidden" name="phone" value={chat.phone} />
          <TextareaField
            name="text"
            label={t('reply')}
            hint={chat.windowOpen ? t('replyHint') : t('windowClosed')}
            required
          />
          <SubmitButton>{t('send')}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
