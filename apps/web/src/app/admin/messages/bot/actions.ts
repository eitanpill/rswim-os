'use server';

import {
  BotReviewInput,
  KnowledgeInput,
  KnowledgeStatusInput,
  reviewBotReply,
  saveKnowledge,
  setKnowledgeStatus,
} from '@rswim/domain-copilot';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PATH = '/admin/messages/bot';

/** Writes a new entry, edits one, or edits and approves a learned suggestion. */
export async function saveKnowledgeAction(_: FormState, fd: FormData) {
  return runForm(fd, KnowledgeInput, (tx, ctx, input) => saveKnowledge(tx, ctx, input), {
    revalidate: PATH,
    success: 'comms.bot.saved',
  });
}

export async function knowledgeStatusAction(_: FormState, fd: FormData) {
  return runForm(fd, KnowledgeStatusInput, (tx, ctx, input) => setKnowledgeStatus(tx, ctx, input), {
    revalidate: PATH,
  });
}

export async function reviewBotReplyAction(_: FormState, fd: FormData) {
  return runForm(fd, BotReviewInput, (tx, ctx, input) => reviewBotReply(tx, ctx, input), {
    revalidate: PATH,
    success: 'comms.bot.reviewed',
  });
}
