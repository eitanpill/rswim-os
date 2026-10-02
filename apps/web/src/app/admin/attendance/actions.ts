'use server';

import { z } from 'zod';
import { AbsenceInput, reportAbsence, withdrawNotice } from '@rswim/domain-attendance';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/** The office records a notice (phone, WhatsApp…) and sees the regulations' decision at once. */
export async function reportAbsenceAction(_: FormState, fd: FormData) {
  return runForm(fd, AbsenceInput, (tx, ctx, input) => reportAbsence(tx, ctx, input), {
    revalidate: `/admin/attendance/${String(fd.get('sessionId'))}`,
    success: (r, tr) =>
      [r.notice, r.credit]
        .filter((e) => e !== null)
        .map((e) => tr(e.code, e.params))
        .join(' · ') || tr('attendance.absence.pending'),
  });
}

export async function withdrawNoticeAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), sessionId: z.uuid() }),
    (tx, ctx, { id }) => withdrawNotice(tx, ctx, id),
    { revalidate: `/admin/attendance/${String(fd.get('sessionId'))}` },
  );
}
