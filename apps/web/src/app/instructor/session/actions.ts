'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { MarksInput, ProgressInput, recordAttendance, setProgress } from '@rswim/domain-attendance';
import { toDomainError } from '@rswim/domain-core';
import { recordTrialVerdict, VerdictInput } from '@rswim/domain-enrollment';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';
import { withSession } from '@/lib/db';

export type SyncResult =
  { ok: true; applied: number; ignored: number } | { ok: false; message: string };

async function guarded<T>(fn: () => Promise<T>): Promise<T | { ok: false; message: string }> {
  try {
    return await fn();
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    const t = await getTranslations();
    return {
      ok: false,
      message: t.has(de.code) ? t(de.code, de.params) : t('forms.errors.invalid'),
    };
  }
}

/**
 * The offline queue's sync: a batch of taps for one lesson. Replays are harmless (each tap has its device id, and the
 * latest tap by device time wins), so the client simply resends whatever it has not seen confirmed.
 */
export async function syncMarksAction(sessionId: string, marks: unknown): Promise<SyncResult> {
  const id = z.uuid().safeParse(sessionId);
  const batch = MarksInput.safeParse(marks);
  if (!id.success || !batch.success) {
    const t = await getTranslations('forms.errors');
    return { ok: false, message: t('invalid') };
  }
  return guarded(async () => {
    const r = await withSession((tx, ctx) => recordAttendance(tx, ctx, id.data, batch.data));
    revalidatePath(`/instructor/session/${id.data}`);
    return { ok: true as const, ...r };
  });
}

/** Ticks or unticks one skill of the child's level. */
export async function setProgressAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = ProgressInput.safeParse(input);
  if (!parsed.success) {
    const t = await getTranslations('forms.errors');
    return { ok: false, message: t('invalid') };
  }
  return guarded(async () => {
    await withSession((tx, ctx) => setProgress(tx, ctx, parsed.data));
    return { ok: true as const };
  });
}

/** The instructor's trial verdict, from the lesson screen. */
export async function instructorVerdictAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    VerdictInput.and(z.object({ id: z.uuid(), sessionId: z.uuid() })),
    (tx, ctx, { id, sessionId: _s, ...verdict }) => recordTrialVerdict(tx, ctx, id, verdict),
    {
      revalidate: `/instructor/session/${String(fd.get('sessionId'))}`,
      success: 'enrollment.trials.verdictSaved',
    },
  );
}
