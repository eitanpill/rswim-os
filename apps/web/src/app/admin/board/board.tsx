'use client';

/**
 * The Group Board (brief §6.2): groups of one venue as cards, children as chips. Drag a chip onto another group, or
 * use "move to…" on a phone; either way the server checks every rule first and the confirm sheet shows why a move is
 * blocked, what it scores and who will be told. Nothing changes until the owner confirms.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type DragEvent } from 'react';
import type { BoardGroup } from '@rswim/domain-scheduling';
import { Badge, Button, Card, cn } from '@rswim/ui';
import { inputClass } from '@/components/form';
import { confirmMoveAction, previewMoveAction, type MovePreview } from './actions';

type Member = BoardGroup['members'][number];
interface Move {
  studentId: string;
  fromTemplateId: string;
  toTemplateId: string;
}

const DRAG_TYPE = 'application/x-rswim-member';

export function Board({
  groups,
  onDate,
  laneLabels,
}: {
  groups: BoardGroup[];
  onDate: string;
  laneLabels: Record<string, string>;
}) {
  const t = useTranslations('scheduling.board');
  const tw = useTranslations('common.weekday');
  const te = useTranslations('enums');
  const router = useRouter();
  const [preview, setPreview] = useState<(MovePreview & { move: Move }) | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ask = (move: Move) => {
    if (move.fromTemplateId === move.toTemplateId) return;
    setNotice(null);
    start(async () => {
      const p = await previewMoveAction({ ...move, onDate, status: 'active' });
      setPreview({ ...p, move });
    });
  };
  const confirm = () => {
    if (!preview) return;
    start(async () => {
      const r = await confirmMoveAction({ ...preview.move, onDate, status: 'active' });
      setNotice({ ok: r.ok, text: r.message });
      setPreview(null);
      if (r.ok) router.refresh();
    });
  };

  const onDrop = (e: DragEvent, toTemplateId: string) => {
    e.preventDefault();
    setOver(null);
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    const { studentId, fromTemplateId } = JSON.parse(raw) as Omit<Move, 'toTemplateId'>;
    ask({ studentId, fromTemplateId, toTemplateId });
  };

  const days = [...new Set(groups.map((g) => g.weekday))].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-6">
      {notice ? (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={cn(
            'rounded-xl px-3 py-2 text-sm',
            notice.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger',
          )}
        >
          {notice.text}
        </p>
      ) : null}

      {days.map((day) => (
        <section key={day} aria-labelledby={`day-${day}`}>
          <h2 id={`day-${day}`} className="mb-2 text-lg font-semibold">
            {tw(String(day))}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups
              .filter((g) => g.weekday === day)
              .map((g) => (
                <Card
                  key={g.id}
                  data-testid={`board-group-${g.name}`}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                      e.preventDefault();
                      setOver(g.id);
                    }
                  }}
                  onDragLeave={() => setOver((o) => (o === g.id ? null : o))}
                  onDrop={(e) => onDrop(e, g.id)}
                  className={cn(
                    'transition-colors',
                    over === g.id && 'border-brand-500 bg-brand-50',
                  )}
                >
                  <header className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{g.name}</h3>
                      <p className="text-sm text-ink-muted">
                        <span dir="ltr">{g.startsAt}</span> ·{' '}
                        {t('lanes', {
                          lanes: g.laneIds.map((id) => laneLabels[id] ?? '?').join(', '),
                        })}
                      </p>
                      <p className="text-sm text-ink-muted">
                        {g.lead ? g.lead.name : <span className="text-danger">{t('noLead')}</span>}
                        {g.levelMin || g.levelMax
                          ? ` · ${[g.levelMin, g.levelMax]
                              .filter(Boolean)
                              .filter((v, i, a) => a.indexOf(v) === i)
                              .join('–')}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Badge tone={g.members.length >= g.capacity ? 'danger' : 'neutral'}>
                        {t('fill', { n: g.members.length, capacity: g.capacity })}
                      </Badge>
                      {g.windowRestriction && g.windowRestriction !== 'mixed' ? (
                        <Badge tone="warn">{te(`gender.${g.windowRestriction}`)}</Badge>
                      ) : null}
                      {g.pendingChange ? <Badge tone="warn">{t('changePending')}</Badge> : null}
                    </div>
                  </header>
                  {g.members.length === 0 ? (
                    <p className="text-sm text-ink-muted">{t('empty')}</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {g.members.map((m) => (
                        <MemberChip
                          key={m.enrollmentId}
                          member={m}
                          group={g}
                          groups={groups}
                          disabled={pending}
                          onMove={(toTemplateId) =>
                            ask({ studentId: m.studentId, fromTemplateId: g.id, toTemplateId })
                          }
                        />
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
          </div>
        </section>
      ))}

      {preview ? (
        <PreviewSheet
          preview={preview}
          pending={pending}
          onConfirm={confirm}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}

function MemberChip({
  member: m,
  group,
  groups,
  disabled,
  onMove,
}: {
  member: Member;
  group: BoardGroup;
  groups: BoardGroup[];
  disabled: boolean;
  onMove: (toTemplateId: string) => void;
}) {
  const t = useTranslations('scheduling.board');
  const ta = useTranslations('scheduling.age');
  const tw = useTranslations('common.weekday');
  const age =
    m.ageMonths === null
      ? null
      : m.ageMonths < 24
        ? ta('months', { n: m.ageMonths })
        : ta('years', { n: Math.floor(m.ageMonths / 12) });
  return (
    <li
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData(
          DRAG_TYPE,
          JSON.stringify({ studentId: m.studentId, fromTemplateId: group.id }),
        );
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="flex cursor-grab items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 active:cursor-grabbing"
      data-testid={`member-${m.firstName} ${m.lastName}`}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        <span className="font-medium">
          {m.firstName} {m.lastName}
        </span>
        {age ? <span className="text-xs text-ink-muted">{age}</span> : null}
        {m.levelName ? <span className="text-xs text-ink-muted">· {m.levelName}</span> : null}
        {m.waterFear ? <Badge tone="warn">{t('waterFear')}</Badge> : null}
        {m.requiresFemaleInstructor ? <Badge tone="warn">{t('femaleOnly')}</Badge> : null}
        {m.status !== 'active' ? <Badge>{t(`status.${m.status}`)}</Badge> : null}
      </div>
      <label className="sr-only" htmlFor={`move-${m.enrollmentId}`}>
        {t('moveTo', { name: m.firstName })}
      </label>
      <select
        id={`move-${m.enrollmentId}`}
        className={cn(inputClass, 'w-24 shrink-0 px-2 text-sm')}
        value=""
        disabled={disabled}
        onChange={(e) => e.target.value && onMove(e.target.value)}
        data-testid="move-picker"
      >
        <option value="">{t('move')}</option>
        {groups
          .filter((o) => o.id !== group.id)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {tw(String(o.weekday))} {o.startsAt}
            </option>
          ))}
      </select>
    </li>
  );
}

function PreviewSheet({
  preview: p,
  pending,
  onConfirm,
  onClose,
}: {
  preview: MovePreview;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('scheduling.board');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-title"
      className="fixed inset-x-0 bottom-0 z-40 max-h-[80dvh] overflow-y-auto rounded-t-card border-t border-line bg-surface-raised p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg sm:inset-x-auto sm:end-4 sm:bottom-4 sm:w-[28rem] sm:rounded-card sm:border"
      data-testid="move-preview"
    >
      <h2 id="move-title" className="mb-2 text-lg font-semibold">
        {p.error ? t('cannotCheck') : t('moveTitle', { name: p.student, to: p.to })}
      </h2>
      {p.error ? (
        <p role="alert" className="text-danger">
          {p.error}
        </p>
      ) : null}
      {p.from ? (
        <p className="mb-2 text-sm text-ink-muted">{t('fromTo', { from: p.from, to: p.to })}</p>
      ) : null}

      {p.violations.length ? (
        <div role="alert" className="mb-3 rounded-xl bg-danger/10 p-3 text-danger">
          <p className="font-semibold">{t('blocked')}</p>
          <ul className="list-disc ps-5">
            {p.violations.map((v) => (
              <li key={v} data-testid="move-violation">
                {v}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.warnings.length ? (
        <ul className="mb-3 list-disc ps-5 text-sm">
          {p.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {p.ok ? (
        <>
          <p className="mb-1 text-sm font-medium">{t('score', { points: p.points })}</p>
          {p.reasons.length ? (
            <ul className="mb-3 text-sm text-ink-muted">
              {p.reasons.map((r) => (
                <li key={r.text}>
                  <span dir="ltr">{r.points > 0 ? `+${r.points}` : r.points}</span> {r.text}
                </li>
              ))}
            </ul>
          ) : null}
          {p.notify.guardians.length || p.notify.instructors.length ? (
            <p className="mb-3 text-sm">
              {t('notify', { names: [...p.notify.guardians, ...p.notify.instructors].join(', ') })}
            </p>
          ) : null}
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {p.ok ? (
          <Button onClick={onConfirm} disabled={pending} aria-busy={pending}>
            {t('confirm')}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>
          {p.ok ? t('cancel') : t('close')}
        </Button>
      </div>
    </div>
  );
}
