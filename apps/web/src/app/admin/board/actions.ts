'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { toDomainError } from '@rswim/domain-core';
import { PlaceInput, placeStudent, previewPlacement } from '@rswim/domain-scheduling';
import { withSession } from '@/lib/db';
import { issueText } from '@/lib/scheduling';

/** What the board's confirm sheet shows, already in the user's language. */
export interface MovePreview {
  ok: boolean;
  student: string;
  from: string | null;
  to: string;
  violations: string[];
  warnings: string[];
  points: number;
  reasons: { text: string; points: number }[];
  notify: { guardians: string[]; instructors: string[] };
  /** Set when the preview itself failed (e.g. the group was removed meanwhile). */
  error?: string;
}

export interface MoveResult {
  ok: boolean;
  message: string;
}

const failed = (message: string): MovePreview => ({
  ok: false,
  student: '',
  from: null,
  to: '',
  violations: [],
  warnings: [],
  points: 0,
  reasons: [],
  notify: { guardians: [], instructors: [] },
  error: message,
});

/** Runs every placement rule for a drag (or a "move to…" pick) without changing anything. */
export async function previewMoveAction(raw: unknown): Promise<MovePreview> {
  const t = await getTranslations();
  const parsed = PlaceInput.safeParse(raw);
  if (!parsed.success) return failed(t('forms.errors.invalid'));
  const text = await issueText();
  try {
    const p = await withSession((tx) => previewPlacement(tx, parsed.data));
    return {
      ok: p.decision.ok,
      student: `${p.student.firstName} ${p.student.lastName}`,
      from: p.from?.name ?? null,
      to: p.to.name,
      violations: p.decision.violations.map(text),
      warnings: p.decision.warnings.map(text),
      points: p.score.points,
      reasons: p.score.reasons.map((r) => ({ text: text(r), points: r.points })),
      notify: p.notify,
    };
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    return failed(text({ code: de.code, params: de.params }));
  }
}

/** Saves the move. The rules run again inside the transaction, so a stale preview cannot sneak a child in. */
export async function confirmMoveAction(raw: unknown): Promise<MoveResult> {
  const t = await getTranslations();
  const parsed = PlaceInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: t('forms.errors.invalid') };
  const text = await issueText();
  try {
    await withSession((tx, ctx) => placeStudent(tx, ctx, parsed.data));
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    return { ok: false, message: text({ code: de.code, params: de.params }) };
  }
  revalidatePath('/admin/board');
  return { ok: true, message: t('scheduling.board.moved') };
}
