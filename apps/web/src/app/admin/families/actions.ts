'use server';

import { z } from 'zod';
import { STUDENT_RELATION_TYPES } from '@rswim/contracts';
import {
  addGuardian,
  addStudent,
  createHousehold,
  GuardianInput,
  HouseholdInput,
  relateStudents,
  StudentInput,
  unrelateStudents,
  updateGuardian,
  updateHousehold,
  updateStudent,
} from '@rswim/domain-people';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const page = (id: string) => `/admin/families/${id}`;

/** Intake: the family and its first guardian in one form (guardian fields are prefixed `g_`). */
const NewFamily = z.object({
  household: HouseholdInput,
  guardian: GuardianInput,
});

export async function createFamilyAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    NewFamily,
    (tx, ctx, { household, guardian }) => createHousehold(tx, ctx, household, guardian),
    {
      redirectTo: ({ householdId }) => page(householdId),
      errorField: (path) =>
        path[0] === 'guardian' ? `g_${String(path[1])}` : String(path[1] ?? path[0]),
    },
    (raw) => {
      const guardian: Record<string, unknown> = {};
      const household: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith('g_')) guardian[k.slice(2)] = v;
        else household[k] = v;
      }
      return { household, guardian };
    },
  );
}

export async function updateHouseholdAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(fd, HouseholdInput, (tx, _ctx, input) => updateHousehold(tx, householdId, input), {
    revalidate: page(householdId),
  });
}

export async function addGuardianAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(fd, GuardianInput, (tx, ctx, input) => addGuardian(tx, ctx, householdId, input), {
    revalidate: page(householdId),
  });
}

export async function updateGuardianAction(
  householdId: string,
  guardianId: string,
  _: FormState,
  fd: FormData,
) {
  return runForm(
    fd,
    GuardianInput,
    (tx, ctx, input) => updateGuardian(tx, ctx, guardianId, input),
    {
      revalidate: page(householdId),
    },
  );
}

export async function addStudentAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(fd, StudentInput, (tx, ctx, input) => addStudent(tx, ctx, householdId, input), {
    revalidate: page(householdId),
  });
}

export async function updateStudentAction(
  householdId: string,
  studentId: string,
  _: FormState,
  fd: FormData,
) {
  return runForm(fd, StudentInput, (tx, _ctx, input) => updateStudent(tx, studentId, input), {
    revalidate: page(householdId),
  });
}

const Relation = z.object({ a: z.uuid(), b: z.uuid(), type: z.enum(STUDENT_RELATION_TYPES) });

export async function relateStudentsAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(fd, Relation, (tx, ctx, { a, b, type }) => relateStudents(tx, ctx, a, b, type), {
    revalidate: page(householdId),
  });
}

export async function unrelateStudentsAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(fd, Relation, (tx, _ctx, { a, b, type }) => unrelateStudents(tx, a, b, type), {
    revalidate: page(householdId),
  });
}
