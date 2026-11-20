'use server';

import {
  ChatHoldInput,
  ChatReplyInput,
  releaseChat,
  replyToChat,
  takeOverChat,
} from '@rswim/domain-comms';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/** Conversations live under both surfaces: a swim school's messages and a freediving club. */
const paths = (fd: FormData) => {
  const digits = String(fd.get('phone') ?? '').replace(/\D/g, '');
  return ['/admin/messages/chats', '/dive/chats'].flatMap((p) => [p, `${p}/${digits}`]);
};

export async function takeOverChatAction(_: FormState, fd: FormData) {
  return runForm(fd, ChatHoldInput, (tx, ctx, v) => takeOverChat(tx, ctx, v), {
    revalidate: paths(fd),
    success: 'chats.taken',
  });
}

export async function releaseChatAction(_: FormState, fd: FormData) {
  return runForm(fd, ChatHoldInput, (tx, _ctx, v) => releaseChat(tx, v), {
    revalidate: paths(fd),
    success: 'chats.released',
  });
}

export async function replyToChatAction(_: FormState, fd: FormData) {
  return runForm(fd, ChatReplyInput, (tx, ctx, v) => replyToChat(tx, ctx, v), {
    revalidate: paths(fd),
    success: 'chats.sent',
  });
}
