import { getTranslations } from 'next-intl/server';
import { RUN_STAGES, type RunStage } from '@rswim/contracts';
import type { RunView } from '@rswim/domain-transport';
import { Badge, Card, CardTitle } from '@rswim/ui';
import { ActionButton, type Action } from '@/components/form';
import { explainer } from '@/lib/billing';
import { enumLabel } from '@/lib/options';
import { clockIL } from '@/lib/scheduling';

export interface RunActions {
  stage: Action;
  mark: Action;
  /** The office only: remove a mistaken tap, call off a run. */
  remove?: Action;
  cancel?: Action;
}

const STATUS_TONE = {
  planned: 'neutral',
  underway: 'warn',
  done: 'ok',
  cancelled: 'danger',
} as const;

/**
 * One day's run of a route, for the escort's phone and the office: the next stage as one big button, each child with
 * their marks, the stages so far with their times, and how long the children were in the water.
 */
export async function RunCard({ view, actions }: { view: RunView; actions: RunActions }) {
  const t = await getTranslations('transport');
  const label = await enumLabel();
  const explain = await explainer();
  const { run, route, riders, stages, next, summary } = view;
  const live = run.status !== 'cancelled' && run.status !== 'done';
  const done = new Map(stages.map((s) => [s.stage, s]));
  const reached = (s: RunStage) => done.has(s);
  const pickupOpen = !RUN_STAGES.slice(RUN_STAGES.indexOf('arrived_pool')).some(reached);
  const later = next ? RUN_STAGES.slice(RUN_STAGES.indexOf(next) + 1) : [];
  const fields = { runId: run.id };

  return (
    <Card data-testid="run-card" data-run={run.id}>
      <CardTitle
        aside={
          <Badge tone={STATUS_TONE[run.status as keyof typeof STATUS_TONE]}>
            {label('runStatus', run.status)}
          </Badge>
        }
      >
        {route.name}
      </CardTitle>
      <p className="text-sm text-ink-muted">
        {t('card.line', {
          school: route.schoolName,
          group: route.groupName,
          venue: route.venueName,
          leaves: route.leavesSchoolAt.slice(0, 5),
          lesson: route.lessonTime,
        })}
      </p>
      {route.escortName || route.vehicle || route.driverName ? (
        <p className="text-sm text-ink-muted">
          {[
            route.escortName && t('card.escort', { name: route.escortName }),
            route.vehicle,
            route.driverName,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}

      {live && next ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <ActionButton
            action={actions.stage}
            fields={{ ...fields, stage: next }}
            className="min-h-14 px-6 text-lg"
            data-testid={`stage-${next}`}
          >
            {t(`tap.${next}`)}
          </ActionButton>
          {later.length > 0 ? (
            <details>
              <summary className="min-h-tap cursor-pointer py-3 text-sm text-ink-muted">
                {t('card.otherStage')}
              </summary>
              <div className="flex flex-wrap gap-2">
                {later
                  .filter((s) => s !== 'out_of_water' || reached('in_water'))
                  .map((s) => (
                    <ActionButton
                      key={s}
                      action={actions.stage}
                      fields={{ ...fields, stage: s }}
                      variant="secondary"
                      data-testid={`stage-${s}`}
                    >
                      {t(`tap.${s}`)}
                    </ActionButton>
                  ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      <ul className="mt-3 flex flex-col gap-2" aria-label={t('card.riders')}>
        {riders.map((r) => {
          const marks = new Set(r.marks.map((m) => m.mark));
          const canDrop =
            live && reached('left_pool') && marks.has('boarded') && !marks.has('dropped_off');
          const canPick = live && pickupOpen && !marks.has('boarded') && !marks.has('missing');
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
              data-testid="run-rider"
              data-student={r.studentId}
            >
              <span>
                <span className="font-medium">{r.name}</span>
                <span className="block text-xs text-ink-muted">
                  {t('card.dropoff', { point: r.dropoffPoint ?? route.schoolName })}
                  {r.dropoffNote ? ` · ${r.dropoffNote}` : ''}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {r.marks.map((m) => (
                  <Badge key={m.mark} tone={m.mark === 'missing' ? 'danger' : 'ok'}>
                    {t(`mark.${m.mark}`)} {clockIL(m.at)}
                  </Badge>
                ))}
                {canPick ? (
                  <>
                    <ActionButton
                      action={actions.mark}
                      fields={{ ...fields, studentId: r.studentId, mark: 'boarded' }}
                      data-testid="mark-boarded"
                    >
                      {t('markTap.boarded')}
                    </ActionButton>
                    <ActionButton
                      action={actions.mark}
                      fields={{ ...fields, studentId: r.studentId, mark: 'missing' }}
                      variant="ghost"
                      data-testid="mark-missing"
                    >
                      {t('markTap.missing')}
                    </ActionButton>
                  </>
                ) : null}
                {canDrop ? (
                  <ActionButton
                    action={actions.mark}
                    fields={{ ...fields, studentId: r.studentId, mark: 'dropped_off' }}
                    data-testid="mark-dropped_off"
                  >
                    {t('markTap.dropped_off')}
                  </ActionButton>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      <ol className="mt-3 flex flex-col text-sm" data-testid="run-stages">
        {RUN_STAGES.filter(reached).map((s) => {
          const ev = done.get(s);
          return (
            <li
              key={s}
              className="flex items-center justify-between gap-2 border-t border-line py-2"
            >
              <span>
                {t(`stage.${s}`)} <span dir="ltr">{ev ? clockIL(ev.at) : ''}</span>
              </span>
              {actions.remove && ev ? (
                <ActionButton action={actions.remove} fields={{ id: ev.id }} variant="ghost">
                  {t('card.remove')}
                </ActionButton>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p
        className={summary.short ? 'mt-2 text-sm text-warn' : 'mt-2 text-sm text-ink-muted'}
        data-testid="run-water"
        role={summary.short ? 'note' : undefined}
      >
        {explain(summary.explanation)}
      </p>
      {actions.cancel && run.status === 'planned' ? (
        <div className="mt-2">
          <ActionButton
            action={actions.cancel}
            fields={{ id: run.id }}
            variant="ghost"
            confirm={t('card.cancelConfirm')}
          >
            {t('card.cancel')}
          </ActionButton>
        </div>
      ) : null}
    </Card>
  );
}
