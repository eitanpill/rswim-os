'use server';

import { z } from 'zod';
import {
  addOverride,
  createTerm,
  deleteOverride,
  generateSessions,
  OverrideInput,
  TermInput,
  updateTerm,
} from '@rswim/domain-scheduling';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const Id = z.object({ id: z.uuid() });

export async function createTermAction(_: FormState, fd: FormData) {
  return runForm(fd, TermInput, (tx, ctx, input) => createTerm(tx, ctx, input), {
    redirectTo: (id) => `/admin/terms/${id}`,
  });
}

export async function updateTermAction(id: string, _: FormState, fd: FormData) {
  return runForm(fd, TermInput, (tx, _ctx, input) => updateTerm(tx, id, input), {
    revalidate: `/admin/terms/${id}`,
  });
}

export async function generateSessionsAction(id: string, _: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx, ctx) => generateSessions(tx, ctx, id), {
    revalidate: `/admin/terms/${id}`,
    success: 'scheduling.terms.generated',
  });
}

export async function addOverrideAction(_: FormState, fd: FormData) {
  return runForm(fd, OverrideInput, (tx, ctx, input) => addOverride(tx, ctx, input), {
    revalidate: '/admin/terms',
  });
}

export async function deleteOverrideAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => deleteOverride(tx, id), {
    revalidate: '/admin/terms',
  });
}
