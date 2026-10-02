import { getTranslations } from 'next-intl/server';
import type { ShiftChangeRow } from '@rswim/domain-scheduling';
import { Badge } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { dmy, enumLabel } from '@/lib/options';
import { clockIL, staffNames } from '@/lib/scheduling';
import { applyWithoutAcceptanceAction, cancelShiftChangeAction } from '../groups/actions';

const TONE = {
  pending: 'warn',
  escalated: 'danger',
  accepted: 'ok',
  applied: 'ok',
  declined: 'danger',
} as const;

/** Shift changes with their state and the owner's two levers: cancel, or apply without waiting. */
export async function ShiftChangeList({
  changes,
  staff,
  path,
}: {
  changes: readonly ShiftChangeRow[];
  staff: readonly { id: string; firstName: string; lastName: string }[];
  path: string;
}) {
  const t = await getTranslations('scheduling.shifts');
  const label = await enumLabel();
  const name = staffNames(staff);
  return (
    <ul className="flex flex-col gap-2" data-testid="shift-changes">
      {changes.map((c) => {
        const open = c.status === 'pending' || c.status === 'escalated';
        return (
          <li key={c.id} className="rounded-xl border border-line p-3" data-testid="shift-change">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {c.kind === 'reassign_group'
                  ? t('reassignGroup', {
                      group: c.groupName ?? '',
                      from: name(c.fromStaffId) || t('nobody'),
                      to: name(c.toStaffId),
                      date: dmy(c.effectiveFrom),
                    })
                  : c.kind === 'reassign_session'
                    ? t('reassignSession', {
                        group: c.groupName ?? '',
                        date: dmy(c.sessionDate),
                        from: name(c.fromStaffId) || t('nobody'),
                        to: name(c.toStaffId),
                      })
                    : t('reschedule', {
                        group: c.groupName ?? '',
                        date: dmy(c.sessionDate),
                        start: c.newStartsAt ? clockIL(c.newStartsAt) : '',
                        end: c.newEndsAt ? clockIL(c.newEndsAt) : '',
                      })}
              </p>
              <Badge tone={TONE[c.status as keyof typeof TONE] ?? 'neutral'}>
                {label('shiftChangeStatus', c.status)}
              </Badge>
            </div>
            <p className="text-sm text-ink-muted">
              {open && c.respondentStaffId
                ? t('waitingFor', { name: name(c.respondentStaffId) })
                : null}
              {c.reason ? ` · ${c.reason}` : ''}
              {c.responseNote ? ` · ${t('note', { note: c.responseNote })}` : ''}
            </p>
            {open || c.status === 'accepted' ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {open ? (
                  <ActionButton
                    action={applyWithoutAcceptanceAction.bind(null, path)}
                    fields={{ id: c.id }}
                    variant="secondary"
                    confirm={t('confirmApply')}
                  >
                    {t('applyNow')}
                  </ActionButton>
                ) : null}
                <ActionButton
                  action={cancelShiftChangeAction.bind(null, path)}
                  fields={{ id: c.id }}
                  variant="ghost"
                >
                  {t('cancel')}
                </ActionButton>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
