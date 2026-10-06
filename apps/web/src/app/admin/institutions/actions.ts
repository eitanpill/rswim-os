'use server';

import { z } from 'zod';
import {
  attachContractGroup,
  cancelInstitutionInvoice,
  ContractGroupInput,
  ContractInput,
  createContract,
  createInstitution,
  detachContractGroup,
  DraftInvoiceInput,
  draftInstitutionInvoice,
  InstitutionInput,
  issueInstitutionInvoice,
  PaymentInput,
  recordInstitutionPayment,
  updateContract,
  updateInstitution,
} from '@rswim/domain-institutions';
import type { FormState } from '@/lib/form-state';
import { runForm, shekelFields } from '@/lib/forms';

const LIST = '/admin/institutions';
const one = (id: string) => `${LIST}/${id}`;
const back = (fd: FormData) => [LIST, one(String(fd.get('institutionId')))];
const WithId = z.object({ id: z.uuid() });

export async function createInstitutionAction(_: FormState, fd: FormData) {
  return runForm(fd, InstitutionInput, (tx, ctx, input) => createInstitution(tx, ctx, input), {
    revalidate: LIST,
    redirectTo: (id) => one(id),
  });
}

export async function updateInstitutionAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.intersection(WithId, InstitutionInput),
    (tx, _ctx, { id, ...input }) => updateInstitution(tx, id, input),
    { revalidate: [LIST, one(String(fd.get('id')))] },
  );
}

export async function createContractAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    ContractInput,
    (tx, ctx, input) => createContract(tx, ctx, input),
    { revalidate: back(fd) },
    shekelFields('amountAgorot'),
  );
}

export async function updateContractAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.intersection(WithId, ContractInput),
    (tx, _ctx, { id, ...input }) => updateContract(tx, id, input),
    { revalidate: back(fd) },
    shekelFields('amountAgorot'),
  );
}

export async function attachContractGroupAction(_: FormState, fd: FormData) {
  return runForm(fd, ContractGroupInput, (tx, ctx, input) => attachContractGroup(tx, ctx, input), {
    revalidate: back(fd),
  });
}

export async function detachContractGroupAction(_: FormState, fd: FormData) {
  return runForm(fd, ContractGroupInput, (tx, _ctx, input) => detachContractGroup(tx, input), {
    revalidate: back(fd),
  });
}

export async function draftInvoiceAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    DraftInvoiceInput,
    (tx, ctx, input) => draftInstitutionInvoice(tx, ctx, input),
    { revalidate: back(fd), success: 'institutions.invoices.drafted' },
  );
}

export async function issueInvoiceAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, ctx, { id }) => issueInstitutionInvoice(tx, ctx, id), {
    revalidate: back(fd),
    success: 'institutions.invoices.issuing',
  });
}

export async function cancelInvoiceAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, _ctx, { id }) => cancelInstitutionInvoice(tx, id), {
    revalidate: back(fd),
  });
}

export async function recordPaymentAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    PaymentInput,
    (tx, ctx, input) => recordInstitutionPayment(tx, ctx, input),
    { revalidate: back(fd), success: 'institutions.invoices.paymentSaved' },
    shekelFields('amountAgorot'),
  );
}
