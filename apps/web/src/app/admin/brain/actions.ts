'use server';

import { z } from 'zod';
import { AGENT_ACTION_KINDS, AgentProfile, AutonomyLevel } from '@rswim/contracts';
import {
  applyAgentProfile,
  confirmCopilotAction,
  dismissCopilotAction,
  saveAgentSettings,
  setAgentPaused,
  undoCopilotAction,
} from '@rswim/domain-copilot';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/** Every screen that shows the brain's actions or settings. */
const PAGES = ['/admin', '/admin/brain', '/admin/brain/journal', '/admin/copilot'];
const WithId = z.object({ id: z.uuid() });

const SettingsForm = z.object({
  profile: AgentProfile,
  levels: z.partialRecord(z.enum(AGENT_ACTION_KINDS), AutonomyLevel),
  maxAutoPerDay: z.coerce.number().int().min(0, 'agent.errors.cap').max(500, 'agent.errors.cap'),
  maxAutoPaymentShekels: z.coerce
    .number()
    .min(0, 'agent.errors.cap')
    .max(100_000, 'agent.errors.cap'),
  paused: z.boolean(),
});

/** Saves the whole table of levels and the caps; the form posts `level:<kind>` per row. */
export async function saveAgentSettingsAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    SettingsForm,
    (tx, ctx, f) =>
      saveAgentSettings(tx, ctx, {
        profile: f.profile,
        levels: f.levels,
        maxAutoPerDay: f.maxAutoPerDay,
        maxAutoPaymentAgorot: Math.round(f.maxAutoPaymentShekels * 100),
        paused: f.paused,
      }),
    { revalidate: PAGES, success: 'agent.saved' },
    (raw) => ({
      ...raw,
      paused: raw.paused === 'on',
      levels: Object.fromEntries(
        AGENT_ACTION_KINDS.flatMap((k) =>
          typeof raw[`level:${k}`] === 'string' ? [[k, raw[`level:${k}`]]] : [],
        ),
      ),
    }),
  );
}

export async function applyAgentProfileAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ profile: AgentProfile }),
    (tx, ctx, { profile }) => applyAgentProfile(tx, ctx, profile),
    { revalidate: PAGES, success: 'agent.profileApplied' },
  );
}

export async function setAgentPausedAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ paused: z.enum(['true', 'false']) }),
    (tx, ctx, { paused }) => setAgentPaused(tx, ctx, paused === 'true'),
    { revalidate: PAGES },
  );
}

/** Runs a waiting action through its service; a refusal by the rules is stored on it with its reason. */
export async function approveAgentActionAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, ctx, { id }) => confirmCopilotAction(tx, ctx, id), {
    revalidate: PAGES,
    success: (r, tr) => (r.status === 'failed' ? tr(r.code, r.params) : tr('copilot.confirmed')),
  });
}

export async function dismissAgentActionAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, ctx, { id }) => dismissCopilotAction(tx, ctx, id), {
    revalidate: PAGES,
  });
}

export async function undoAgentActionAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, ctx, { id }) => undoCopilotAction(tx, ctx, id), {
    revalidate: PAGES,
    success: 'agent.undone',
  });
}
