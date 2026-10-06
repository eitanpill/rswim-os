'use server';

import { z } from 'zod';
import type { Tx } from '@rswim/db';
import { bookingsInSessions } from '@rswim/domain-attendance';
import { chargedPlaces } from '@rswim/domain-billing';
import {
  createMigration,
  deleteMigration,
  deleteMigrationItem,
  executeMigration,
  MigrationInput,
  MigrationItemInput,
  relocateAllTo,
  revertMigration,
  saveMigrationItem,
  type MigrationDeps,
} from '@rswim/domain-scheduling';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const LIST = '/admin/venues/migrations';
const one = (id: string) => `${LIST}/${id}`;
const WithId = z.object({ id: z.uuid() });

/** What the wizard needs from other modules: bookings on lessons it would cancel, places billing already charged. */
const deps = (tx: Tx): MigrationDeps => ({
  bookingsInSessions: (ids) => bookingsInSessions(tx, ids),
  chargedPlaces: (ids) => chargedPlaces(tx, ids),
});

export async function createMigrationAction(_: FormState, fd: FormData) {
  return runForm(fd, MigrationInput, (tx, ctx, input) => createMigration(tx, ctx, input), {
    revalidate: LIST,
    redirectTo: (id) => one(id),
  });
}

export async function relocateAllAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ migrationId: z.uuid(), targetVenueId: z.uuid() }),
    (tx, ctx, { migrationId, targetVenueId }) => relocateAllTo(tx, ctx, migrationId, targetVenueId),
    { revalidate: one(String(fd.get('migrationId'))) },
  );
}

/** The relocate form names the target as "venueId:poolId" in one select. */
const splitTarget = (raw: Record<string, unknown>) => {
  const [targetVenueId, targetPoolId] = String(raw.target ?? '').split(':');
  return { ...raw, targetVenueId, targetPoolId };
};

export async function saveItemAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    MigrationItemInput,
    (tx, ctx, input) => saveMigrationItem(tx, ctx, input),
    { revalidate: one(String(fd.get('migrationId'))), success: 'migrations.saved' },
    splitTarget,
  );
}

export async function deleteItemAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ migrationId: z.uuid(), sourceTemplateId: z.uuid() }),
    (tx, _ctx, { migrationId, sourceTemplateId }) =>
      deleteMigrationItem(tx, migrationId, sourceTemplateId),
    { revalidate: one(String(fd.get('migrationId'))) },
  );
}

export async function executeMigrationAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, ctx, { id }) => executeMigration(tx, ctx, id, deps(tx)), {
    revalidate: [LIST, one(String(fd.get('id')))],
    success: 'migrations.executed',
  });
}

export async function revertMigrationAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, ctx, { id }) => revertMigration(tx, ctx, id, deps(tx)), {
    revalidate: [LIST, one(String(fd.get('id')))],
    success: 'migrations.reverted',
  });
}

export async function deleteMigrationAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, _ctx, { id }) => deleteMigration(tx, id), {
    revalidate: LIST,
    redirectTo: () => LIST,
  });
}
