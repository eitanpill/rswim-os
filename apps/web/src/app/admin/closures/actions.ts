'use server';

import { z } from 'zod';
import {
  ClosureEventInput,
  closeClosureEvent,
  createClosureEvent,
  discardClosureEvent,
  openClosureEvent,
} from '@rswim/domain-attendance';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PATH = '/admin/closures';
const Id = z.object({ id: z.uuid() });

/** Saves the closure as a draft and shows its preview; nothing changes until the owner opens it. */
export async function createClosureAction(_: FormState, fd: FormData) {
  return runForm(fd, ClosureEventInput, (tx, ctx, input) => createClosureEvent(tx, ctx, input), {
    redirectTo: (id) => `${PATH}/${id}`,
  });
}

export async function openClosureAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, ctx, { id }) => openClosureEvent(tx, ctx, id), {
    redirectTo: (r) => `${PATH}/${String(fd.get('id'))}?opened=${r.creditsIssued}`,
  });
}

export async function discardClosureAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => discardClosureEvent(tx, id), {
    redirectTo: () => PATH,
  });
}

export async function closeClosureAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, ctx, { id }) => closeClosureEvent(tx, ctx, id), {
    redirectTo: () => `${PATH}/${String(fd.get('id'))}`,
  });
}
