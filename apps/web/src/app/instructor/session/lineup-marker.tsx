'use client';

/**
 * One-tap attendance that works at the pool edge without signal: every tap is kept in a queue in localStorage and
 * sent when the phone is online. The server keeps each child's latest tap by device time, so resending is safe.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Badge, Button, cn } from '@rswim/ui';
import { setProgressAction, syncMarksAction } from './actions';

type Status = 'present' | 'late' | 'absent';

export interface MarkerRow {
  studentId: string;
  name: string;
  age: string;
  kind: 'member' | 'makeup' | 'trial';
  frozen: boolean;
  notified: boolean;
  flags: string[];
  levelId: string | null;
  levelName: string | null;
  skills: { code: string; he: string; achieved: boolean }[];
  mark: { status: Status; minutesLate: number | null } | null;
}

interface QueuedMark {
  studentId: string;
  status: Status;
  minutesLate: number | null;
  clientMarkId: string;
  markedAt: string;
  note: null;
}

const LATE_MINUTES = [5, 10, 15, 20, 30];

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function readQueue(key: string): QueuedMark[] {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? '[]') as QueuedMark[];
  } catch {
    return [];
  }
}

function writeQueue(key: string, q: QueuedMark[]) {
  try {
    if (q.length) window.localStorage.setItem(key, JSON.stringify(q));
    else window.localStorage.removeItem(key);
  } catch {
    // Storage full or blocked: the marks still sync while the page stays open.
  }
}

export function LineupMarker({
  sessionId,
  rows,
  canMark,
}: {
  sessionId: string;
  rows: MarkerRow[];
  canMark: boolean;
}) {
  const t = useTranslations('attendance.lineup');
  const te = useTranslations('enums');
  const tf = useTranslations('attendance.flags');
  const key = `rswim.marks.${sessionId}`;
  const [marks, setMarks] = useState<
    Record<string, { status: Status; minutesLate: number | null }>
  >(() =>
    Object.fromEntries(
      rows
        .filter((r) => r.mark)
        .map((r) => [r.studentId, r.mark as NonNullable<MarkerRow['mark']>]),
    ),
  );
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lateFor, setLateFor] = useState<string | null>(null);
  const [openSkills, setOpenSkills] = useState<string | null>(null);
  const [skills, setSkills] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      rows.flatMap((r) => r.skills.map((s) => [`${r.studentId}:${s.code}`, s.achieved])),
    ),
  );
  const [, startTransition] = useTransition();
  const flushing = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return;
    const queue = readQueue(key);
    if (queue.length === 0) return;
    flushing.current = true;
    try {
      const r = await syncMarksAction(sessionId, queue);
      if (r.ok) {
        const sent = new Set(queue.map((m) => m.clientMarkId));
        const rest = readQueue(key).filter((m) => !sent.has(m.clientMarkId));
        writeQueue(key, rest);
        setPending(rest.length);
        setError(null);
      } else setError(r.message);
    } catch {
      // Offline mid-request: the queue stays and is sent on the next "online".
    } finally {
      flushing.current = false;
    }
  }, [key, sessionId]);

  useEffect(() => {
    const queued = readQueue(key);
    setPending(queued.length);
    // Taps made before a reload show until the server confirms them.
    if (queued.length) {
      setMarks((m) => ({
        ...m,
        ...Object.fromEntries(
          queued.map((q) => [q.studentId, { status: q.status, minutesLate: q.minutesLate }]),
        ),
      }));
    }
    void flush();
    const online = () => void flush();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [flush, key]);

  const tap = (studentId: string, status: Status, minutesLate: number | null = null) => {
    setLateFor(null);
    setMarks((m) => ({ ...m, [studentId]: { status, minutesLate } }));
    const mark: QueuedMark = {
      studentId,
      status,
      minutesLate,
      clientMarkId: newId(),
      markedAt: new Date().toISOString(),
      note: null,
    };
    // One entry per child: the latest tap replaces an unsent earlier one.
    const queue = [...readQueue(key).filter((q) => q.studentId !== studentId), mark];
    writeQueue(key, queue);
    setPending(queue.length);
    startTransition(() => void flush());
  };

  const tick = (r: MarkerRow, code: string, achieved: boolean) => {
    if (!r.levelId) return;
    const k = `${r.studentId}:${code}`;
    setSkills((s) => ({ ...s, [k]: achieved }));
    startTransition(async () => {
      const res = await setProgressAction({
        studentId: r.studentId,
        levelId: r.levelId,
        skillCode: code,
        sessionId,
        achieved,
      }).catch(() => ({ ok: false as const, message: t('progressOffline') }));
      if (!res.ok) {
        setSkills((s) => ({ ...s, [k]: !achieved }));
        setError(res.message);
      }
    });
  };

  const counts = { present: 0, late: 0, absent: 0 };
  for (const m of Object.values(marks)) counts[m.status]++;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-live="polite">
        <span data-testid="mark-counts">
          {t('counts', {
            present: counts.present + counts.late,
            absent: counts.absent,
            total: rows.length,
          })}
        </span>
        {pending > 0 ? (
          <Badge tone="warn" data-testid="sync-pending">
            {t('pending', { n: pending })}
          </Badge>
        ) : (
          <Badge tone="ok" data-testid="sync-done">
            {t('synced')}
          </Badge>
        )}
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const m = marks[r.studentId];
          return (
            <li
              key={r.studentId}
              className={cn(
                'rounded-xl border border-line p-3',
                m?.status === 'absent' && 'border-danger/50',
                m && m.status !== 'absent' && 'border-ok/60',
              )}
              data-testid="mark-row"
              data-student={r.name}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-lg font-medium">
                    {r.name} <span className="text-sm text-ink-muted">{r.age}</span>
                  </p>
                  <p className="flex flex-wrap gap-1 text-sm text-ink-muted">
                    {r.levelName ? <span>{r.levelName}</span> : null}
                    {r.kind !== 'member' ? (
                      <Badge tone="warn">{te(`attendanceKind.${r.kind}`)}</Badge>
                    ) : null}
                    {r.frozen ? <Badge>{te('enrollmentStatus.frozen')}</Badge> : null}
                    {r.notified ? <Badge tone="warn">{t('notified')}</Badge> : null}
                    {r.flags.map((f) => (
                      <Badge key={f} tone={f === 'medical' ? 'danger' : 'neutral'}>
                        {tf(f)}
                      </Badge>
                    ))}
                  </p>
                </div>
                {m ? (
                  <Badge tone={m.status === 'absent' ? 'danger' : 'ok'} data-testid="mark-status">
                    {te(`attendanceStatus.${m.status}`)}
                    {m.minutesLate ? ` (${t('minutes', { n: m.minutesLate })})` : ''}
                  </Badge>
                ) : null}
              </div>
              {canMark ? (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant={m?.status === 'present' ? 'primary' : 'secondary'}
                    onClick={() => tap(r.studentId, 'present')}
                  >
                    {te('attendanceStatus.present')}
                  </Button>
                  <Button
                    type="button"
                    variant={m?.status === 'late' ? 'primary' : 'secondary'}
                    onClick={() => setLateFor(lateFor === r.studentId ? null : r.studentId)}
                    aria-expanded={lateFor === r.studentId}
                  >
                    {te('attendanceStatus.late')}
                  </Button>
                  <Button
                    type="button"
                    variant={m?.status === 'absent' ? 'primary' : 'secondary'}
                    onClick={() => tap(r.studentId, 'absent')}
                  >
                    {te('attendanceStatus.absent')}
                  </Button>
                </div>
              ) : null}
              {lateFor === r.studentId ? (
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t('lateBy')}>
                  {LATE_MINUTES.map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant="ghost"
                      onClick={() => tap(r.studentId, 'late', n)}
                    >
                      {t('minutes', { n })}
                    </Button>
                  ))}
                </div>
              ) : null}
              {r.skills.length && r.levelId ? (
                <div className="mt-2">
                  <button
                    type="button"
                    className="min-h-tap text-sm text-brand-700"
                    aria-expanded={openSkills === r.studentId}
                    onClick={() => setOpenSkills(openSkills === r.studentId ? null : r.studentId)}
                  >
                    {t('skills', {
                      done: r.skills.filter((s) => skills[`${r.studentId}:${s.code}`]).length,
                      total: r.skills.length,
                    })}
                  </button>
                  {openSkills === r.studentId ? (
                    <ul className="flex flex-col">
                      {r.skills.map((s) => (
                        <li key={s.code}>
                          <label className="flex min-h-tap items-center gap-3">
                            <input
                              type="checkbox"
                              className="size-5 accent-brand-600"
                              checked={skills[`${r.studentId}:${s.code}`] ?? false}
                              onChange={(e) => tick(r, s.code, e.target.checked)}
                            />
                            <span>{s.he}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
