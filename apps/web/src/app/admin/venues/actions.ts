'use server';

import { z } from 'zod';
import {
  addClosure,
  addContract,
  ClosureInput,
  ContractInput,
  createPool,
  createVenue,
  deleteClosure,
  deleteContract,
  deletePool,
  deleteWindow,
  PoolInput,
  saveWindow,
  updateVenue,
  VenueInput,
  WindowFormInput,
} from '@rswim/domain-venues';
import type { FormState } from '@/lib/form-state';
import { runForm, shekelFields } from '@/lib/forms';

const Id = z.object({ id: z.uuid() });
const page = (venueId: string) => `/admin/venues/${venueId}`;

export async function createVenueAction(_: FormState, fd: FormData) {
  return runForm(fd, VenueInput, (tx, ctx, input) => createVenue(tx, ctx, input), {
    redirectTo: (id) => page(id),
  });
}

export async function updateVenueAction(venueId: string, _: FormState, fd: FormData) {
  return runForm(fd, VenueInput, (tx, ctx, input) => updateVenue(tx, ctx, venueId, input), {
    revalidate: page(venueId),
  });
}

export async function createPoolAction(venueId: string, _: FormState, fd: FormData) {
  return runForm(fd, PoolInput, (tx, ctx, input) => createPool(tx, ctx, venueId, input), {
    revalidate: page(venueId),
  });
}

export async function deletePoolAction(venueId: string, _: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => deletePool(tx, id), { revalidate: page(venueId) });
}

export async function saveWindowAction(venueId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    WindowFormInput.extend({ id: z.uuid().optional() }),
    (tx, ctx, { id, ...input }) => saveWindow(tx, ctx, venueId, input, id),
    { revalidate: page(venueId) },
    // An unticked lane group posts nothing; send an empty list so the "pick lanes" message shows.
    (raw) => ({ laneIds: [], ...raw, id: raw.id || undefined }),
  );
}

export async function deleteWindowAction(venueId: string, _: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, ctx, { id }) => deleteWindow(tx, ctx, venueId, id), {
    revalidate: page(venueId),
  });
}

export async function addClosureAction(venueId: string, _: FormState, fd: FormData) {
  return runForm(fd, ClosureInput, (tx, ctx, input) => addClosure(tx, ctx, venueId, input), {
    revalidate: page(venueId),
  });
}

export async function deleteClosureAction(venueId: string, _: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => deleteClosure(tx, id), {
    revalidate: page(venueId),
  });
}

export async function addContractAction(venueId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    ContractInput,
    (tx, ctx, input) => addContract(tx, ctx, venueId, input),
    { revalidate: page(venueId) },
    shekelFields('amountAgorot'),
  );
}

export async function deleteContractAction(venueId: string, _: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => deleteContract(tx, id), {
    revalidate: page(venueId),
  });
}
