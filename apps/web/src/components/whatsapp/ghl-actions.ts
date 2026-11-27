'use server';

import { z } from 'zod';
import { GhlBridgeConnectInput, GhlBridgeModeInput } from '@rswim/contracts';
import {
  connectGhlBridge,
  disconnectGhlBridge,
  dismissSuggestion,
  requestGhlBridgeCheck,
  sendSuggestion,
  setGhlBridgeMode,
} from '@rswim/domain-comms';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/** The WhatsApp page of a swim school and of a freediving club, and the screens that show what is connected. */
const ALL = [
  '/admin/integrations/whatsapp',
  '/dive/whatsapp',
  '/admin/integrations/ghl',
  '/admin/connections',
  '/dive/connections',
];
const CHATS = ['/admin/messages/chats', '/dive/chats'];

/** The owner connects (or replaces) the business's GHL sub-account; the token is never echoed back. */
export async function connectGhlBridgeAction(_: FormState, fd: FormData) {
  return runForm(fd, GhlBridgeConnectInput, (tx, ctx, input) => connectGhlBridge(tx, ctx, input), {
    revalidate: ALL,
    success: 'ghlBridge.connected',
  });
}

export async function checkGhlBridgeAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx, ctx) => requestGhlBridgeCheck(tx, ctx), {
    revalidate: ALL,
    success: 'ghlBridge.checkAsked',
  });
}

/** Shadow (the bots suggest) or live (the bots answer). */
export async function ghlBridgeModeAction(_: FormState, fd: FormData) {
  return runForm(fd, GhlBridgeModeInput, (tx, _ctx, input) => setGhlBridgeMode(tx, input), {
    revalidate: ALL,
    success: 'ghlBridge.modeSaved',
  });
}

export async function disconnectGhlBridgeAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx) => disconnectGhlBridge(tx), {
    revalidate: ALL,
    success: 'ghlBridge.disconnected',
  });
}

const Suggestion = z.object({ messageId: z.uuid() });

/** A person sends the bot's suggestion as it is. */
export async function sendSuggestionAction(_: FormState, fd: FormData) {
  return runForm(fd, Suggestion, (tx, ctx, { messageId }) => sendSuggestion(tx, ctx, messageId), {
    revalidate: CHATS,
    success: 'ghlBridge.suggestionSent',
  });
}

/** A person drops the bot's suggestion. */
export async function dismissSuggestionAction(_: FormState, fd: FormData) {
  return runForm(fd, Suggestion, (tx, _ctx, { messageId }) => dismissSuggestion(tx, messageId), {
    revalidate: CHATS,
    success: 'ghlBridge.suggestionDismissed',
  });
}
