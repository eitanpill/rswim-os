'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import {
  addAvailabilityException,
  addAvailabilityRule,
  addCertification,
  addPayRule,
  AvailabilityExceptionInput,
  AvailabilityRuleInput,
  CertificationInput,
  createInvite,
  createStaff,
  deleteAvailabilityException,
  deleteAvailabilityRule,
  deleteCertification,
  InviteInput,
  PayRuleInput,
  revokeInvite,
  StaffInput,
  updateStaff,
} from '@rswim/domain-staff';
import type { FormState } from '@/lib/form-state';
import { runForm, shekelFields } from '@/lib/forms';

const Id = z.object({ id: z.uuid() });
const page = (id: string) => `/admin/staff/${id}`;
// An unticked skills group posts nothing.
const withSkills = (raw: Record<string, unknown>) => ({ skills: [], ...raw });

export async function createStaffAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    StaffInput,
    (tx, ctx, input) => createStaff(tx, ctx, input),
    { redirectTo: page },
    withSkills,
  );
}

export async function updateStaffAction(staffId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    StaffInput,
    (tx, _ctx, input) => updateStaff(tx, staffId, input),
    { revalidate: page(staffId) },
    withSkills,
  );
}

export async function addCertificationAction(staffId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    CertificationInput,
    (tx, ctx, input) => addCertification(tx, ctx, staffId, input),
    {
      revalidate: page(staffId),
    },
  );
}

export async function deleteCertificationAction(staffId: string, _: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => deleteCertification(tx, id), {
    revalidate: page(staffId),
  });
}

export async function addAvailabilityAction(staffId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    AvailabilityRuleInput,
    (tx, ctx, input) => addAvailabilityRule(tx, ctx, staffId, input),
    {
      revalidate: page(staffId),
    },
  );
}

export async function deleteAvailabilityAction(staffId: string, _: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => deleteAvailabilityRule(tx, id), {
    revalidate: page(staffId),
  });
}

export async function addExceptionAction(staffId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    AvailabilityExceptionInput,
    (tx, ctx, input) => addAvailabilityException(tx, ctx, staffId, input),
    { revalidate: page(staffId) },
  );
}

export async function deleteExceptionAction(staffId: string, _: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => deleteAvailabilityException(tx, id), {
    revalidate: page(staffId),
  });
}

export async function addPayRuleAction(staffId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    PayRuleInput,
    (tx, ctx, input) => addPayRule(tx, ctx, staffId, input),
    { revalidate: page(staffId) },
    shekelFields('amountAgorot', 'travelAllowanceAgorot'),
  );
}

export async function createInviteAction(_: FormState, fd: FormData) {
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`;
  return runForm(fd, InviteInput, (tx, ctx, input) => createInvite(tx, ctx, input), {
    revalidate: '/admin/staff',
    success: 'staff.invite.created',
    // The token exists only in this response; the database keeps its hash.
    data: ({ token }) => ({ link: `${origin}/invite/${token}` }),
  });
}

export async function revokeInviteAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => revokeInvite(tx, id), {
    revalidate: '/admin/staff',
  });
}
