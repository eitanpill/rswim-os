'use server';

import { z } from 'zod';
import {
  approveTriageAction,
  BroadcastInput,
  cancelBroadcast,
  createBroadcast,
  ReplyInput,
  replyToInbound,
  resolveInbound,
  setAutomation,
  TemplateInput,
  updateTemplate,
} from '@rswim/domain-comms';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PATH = '/admin/messages';

/** One tap: the draft action becomes real (an absence is recorded with the regulations' decision). */
export async function approveActionAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid() }),
    (tx, ctx, { id }) => approveTriageAction(tx, ctx, id),
    {
      revalidate: PATH,
      success: 'comms.inbox.approved',
    },
  );
}

export async function resolveInboundAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), status: z.enum(['actioned', 'dismissed']) }),
    (tx, ctx, { id, status }) => resolveInbound(tx, ctx, id, status),
    { revalidate: PATH, success: 'comms.inbox.done' },
  );
}

export async function replyAction(_: FormState, fd: FormData) {
  return runForm(fd, ReplyInput, (tx, ctx, input) => replyToInbound(tx, ctx, input), {
    revalidate: PATH,
    success: 'comms.inbox.sent',
  });
}

export async function saveTemplateAction(_: FormState, fd: FormData) {
  return runForm(fd, TemplateInput, (tx, ctx, input) => updateTemplate(tx, ctx, input), {
    revalidate: `${PATH}/templates`,
  });
}

export async function setAutomationAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), enabled: z.enum(['true', 'false']) }),
    (tx, _ctx, { id, enabled }) => setAutomation(tx, id, enabled === 'true'),
    { revalidate: `${PATH}/templates` },
  );
}

export async function broadcastAction(_: FormState, fd: FormData) {
  return runForm(fd, BroadcastInput, (tx, ctx, input) => createBroadcast(tx, ctx, input), {
    revalidate: `${PATH}/broadcast`,
    success: (r, tr) =>
      r.status === 'scheduled'
        ? tr('comms.broadcast.scheduled')
        : tr('comms.broadcast.sent', {
            households: r.households,
            queued: r.queued,
            blocked: r.blocked,
          }),
  });
}

export async function cancelBroadcastAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({ id: z.uuid() }), (tx, _ctx, { id }) => cancelBroadcast(tx, id), {
    revalidate: `${PATH}/broadcast`,
  });
}
