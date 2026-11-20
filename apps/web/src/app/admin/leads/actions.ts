'use server';

import { replyToLead, LeadReplyInput } from '@rswim/domain-comms';
import {
  createLead,
  LeadInput,
  LeadStageMove,
  LeadUpdate,
  moveLeadStage,
  updateLead,
} from '@rswim/domain-crm';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PATH = '/admin/leads';
/** The list and the lead's own page. */
const paths = (fd: FormData, key = 'id') => [PATH, `${PATH}/${String(fd.get(key) ?? '')}`];

export async function createLeadAction(_: FormState, fd: FormData) {
  return runForm(fd, LeadInput, (tx, ctx, input) => createLead(tx, ctx, input), {
    revalidate: PATH,
    redirectTo: (id) => `${PATH}/${id}`,
  });
}

export async function updateLeadAction(_: FormState, fd: FormData) {
  return runForm(fd, LeadUpdate, (tx, _ctx, input) => updateLead(tx, input), {
    revalidate: paths(fd),
    success: 'leads.saved',
  });
}

export async function moveLeadAction(_: FormState, fd: FormData) {
  return runForm(fd, LeadStageMove, (tx, _ctx, input) => moveLeadStage(tx, input), {
    revalidate: paths(fd),
  });
}

export async function replyToLeadAction(_: FormState, fd: FormData) {
  return runForm(fd, LeadReplyInput, (tx, ctx, input) => replyToLead(tx, ctx, input), {
    revalidate: paths(fd, 'leadId'),
    success: 'leads.replySent',
  });
}
