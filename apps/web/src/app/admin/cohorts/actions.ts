'use server';

import { z } from 'zod';
import {
  addCohortStaff,
  attachGroup,
  cancelRegistration,
  CohortGroupInput,
  CohortInput,
  CohortStaffInput,
  CohortStatusInput,
  createCohort,
  detachGroup,
  RegisterInput,
  registerToCohort,
  removeCohortStaff,
  setCohortStatus,
  updateCohort,
} from '@rswim/domain-scheduling';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const LIST = '/admin/cohorts';
const one = (id: string) => `${LIST}/${id}`;
const WithId = z.object({ id: z.uuid() });

export async function createCohortAction(_: FormState, fd: FormData) {
  return runForm(fd, CohortInput, (tx, ctx, input) => createCohort(tx, ctx, input), {
    revalidate: LIST,
    redirectTo: (id) => one(id),
  });
}

export async function updateCohortAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.intersection(WithId, CohortInput),
    (tx, _ctx, { id, ...input }) => updateCohort(tx, id, input),
    { revalidate: [LIST, one(String(fd.get('id')))] },
  );
}

export async function cohortStatusAction(_: FormState, fd: FormData) {
  return runForm(fd, CohortStatusInput, (tx, _ctx, input) => setCohortStatus(tx, input), {
    revalidate: [LIST, one(String(fd.get('id')))],
  });
}

export async function attachGroupAction(_: FormState, fd: FormData) {
  return runForm(fd, CohortGroupInput, (tx, _ctx, input) => attachGroup(tx, input), {
    revalidate: one(String(fd.get('cohortId'))),
  });
}

export async function detachGroupAction(_: FormState, fd: FormData) {
  return runForm(fd, CohortGroupInput, (tx, _ctx, input) => detachGroup(tx, input), {
    revalidate: one(String(fd.get('cohortId'))),
  });
}

export async function addCohortStaffAction(_: FormState, fd: FormData) {
  return runForm(fd, CohortStaffInput, (tx, ctx, input) => addCohortStaff(tx, ctx, input), {
    revalidate: one(String(fd.get('cohortId'))),
  });
}

export async function removeCohortStaffAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), cohortId: z.uuid() }),
    (tx, _ctx, { id }) => removeCohortStaff(tx, id),
    { revalidate: one(String(fd.get('cohortId'))) },
  );
}

export async function registerAction(_: FormState, fd: FormData) {
  return runForm(fd, RegisterInput, (tx, ctx, input) => registerToCohort(tx, ctx, input), {
    revalidate: [LIST, one(String(fd.get('cohortId')))],
    success: 'cohorts.registered',
  });
}

export async function cancelRegistrationAction(_: FormState, fd: FormData) {
  return runForm(fd, RegisterInput, (tx, ctx, input) => cancelRegistration(tx, ctx, input), {
    revalidate: [LIST, one(String(fd.get('cohortId')))],
  });
}
