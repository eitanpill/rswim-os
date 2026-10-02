'use server';

import { z } from 'zod';
import { requiredDate } from '@rswim/contracts';
import {
  applyShiftChange,
  archiveGroup,
  cancelShiftChange,
  createGroup,
  placeStudent,
  removeStudent,
  requestShiftChange,
  ShiftChangeInput,
  TemplateInput,
  updateGroup,
} from '@rswim/domain-scheduling';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const page = (id: string) => `/admin/groups/${id}`;
const Id = z.object({ id: z.uuid() });

/** The pool picker posts "venueId:poolId"; unticked lanes and skills post nothing, so send empty lists. */
const prepareGroup = (raw: Record<string, unknown>) => {
  const [venueId, poolId] = String(raw.place ?? ':').split(':');
  return { laneIds: [], requiredSkills: [], ...raw, venueId, poolId };
};

export async function createGroupAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    TemplateInput,
    (tx, ctx, input) => createGroup(tx, ctx, input),
    {
      redirectTo: (id) => page(id),
    },
    prepareGroup,
  );
}

export async function updateGroupAction(id: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    TemplateInput,
    (tx, ctx, input) => updateGroup(tx, ctx, id, input),
    {
      revalidate: page(id),
    },
    prepareGroup,
  );
}

export async function archiveGroupAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, ctx, { id }) => archiveGroup(tx, ctx, id), {
    redirectTo: () => '/admin/groups',
  });
}

export async function requestShiftChangeAction(groupId: string, _: FormState, fd: FormData) {
  return runForm(fd, ShiftChangeInput, (tx, ctx, input) => requestShiftChange(tx, ctx, input), {
    revalidate: [page(groupId), '/admin/shifts'],
    success: 'scheduling.shift.requested',
  });
}

export async function cancelShiftChangeAction(path: string, _: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, ctx, { id }) => cancelShiftChange(tx, ctx, id), { revalidate: path });
}

export async function applyWithoutAcceptanceAction(path: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    Id,
    (tx, ctx, { id }) => applyShiftChange(tx, ctx, id, { withoutAcceptance: true }),
    { revalidate: path },
  );
}

const Place = z.object({ studentId: z.uuid(), onDate: requiredDate() });

export async function placeInGroupAction(groupId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    Place,
    (tx, ctx, { studentId, onDate }) =>
      placeStudent(tx, ctx, {
        studentId,
        toTemplateId: groupId,
        fromTemplateId: null,
        onDate,
        status: 'active',
      }),
    { revalidate: page(groupId) },
  );
}

export async function removeFromGroupAction(groupId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    Place,
    (tx, ctx, { studentId, onDate }) =>
      removeStudent(tx, ctx, { studentId, templateId: groupId, onDate }),
    { revalidate: page(groupId) },
  );
}
