'use server';

import { z } from 'zod';
import {
  addLevel,
  createProgram,
  deleteLevel,
  LevelInput,
  moveLevel,
  ProgramInput,
  updateProgram,
} from '@rswim/domain-settings';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PAGE = '/admin/programs';

export async function createProgramAction(_: FormState, fd: FormData) {
  return runForm(fd, ProgramInput, (tx, ctx, input) => createProgram(tx, ctx, input), {
    revalidate: PAGE,
  });
}

export async function updateProgramAction(programId: string, _: FormState, fd: FormData) {
  return runForm(fd, ProgramInput, (tx, _ctx, input) => updateProgram(tx, programId, input), {
    revalidate: PAGE,
  });
}

export async function addLevelAction(programId: string, _: FormState, fd: FormData) {
  return runForm(fd, LevelInput, (tx, ctx, input) => addLevel(tx, ctx, programId, input), {
    revalidate: PAGE,
  });
}

export async function deleteLevelAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({ id: z.uuid() }), (tx, _ctx, { id }) => deleteLevel(tx, id), {
    revalidate: PAGE,
  });
}

export async function moveLevelAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), direction: z.enum(['up', 'down']) }),
    (tx, _ctx, { id, direction }) => moveLevel(tx, id, direction),
    { revalidate: PAGE },
  );
}
