'use server';

import { z } from 'zod';
import {
  createPriceList,
  deletePriceItem,
  deletePriceList,
  duplicatePriceList,
  PriceItemInput,
  PriceListInput,
  publishPriceList,
  savePriceItem,
} from '@rswim/domain-settings';
import type { FormState } from '@/lib/form-state';
import { runForm, shekelFields } from '@/lib/forms';

const Id = z.object({ id: z.uuid() });
const page = (id: string) => `/admin/prices/${id}`;

export async function createPriceListAction(_: FormState, fd: FormData) {
  return runForm(fd, PriceListInput, (tx, ctx, input) => createPriceList(tx, ctx, input), {
    redirectTo: page,
  });
}

/** "New version from date": copies the items into a draft. */
export async function duplicatePriceListAction(sourceId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    PriceListInput,
    (tx, ctx, input) => duplicatePriceList(tx, ctx, sourceId, input),
    {
      redirectTo: page,
    },
  );
}

export async function savePriceItemAction(listId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    PriceItemInput,
    (tx, ctx, input) => savePriceItem(tx, ctx, listId, input),
    { revalidate: page(listId) },
    shekelFields('amountAgorot'),
  );
}

export async function deletePriceItemAction(listId: string, _: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => deletePriceItem(tx, id), {
    revalidate: page(listId),
  });
}

export async function publishPriceListAction(listId: string, _: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx, ctx) => publishPriceList(tx, ctx, listId), {
    revalidate: [page(listId), '/admin/prices'],
    success: 'prices.published',
  });
}

export async function deletePriceListAction(listId: string, _: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx) => deletePriceList(tx, listId), {
    redirectTo: () => '/admin/prices',
  });
}
