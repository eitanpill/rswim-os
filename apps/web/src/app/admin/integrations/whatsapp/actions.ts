'use server';

import { z } from 'zod';
import { MetaTemplateInput, WhatsAppConnectInput } from '@rswim/contracts';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  requestMetaTemplates,
  requestWhatsAppCheck,
  sendWhatsAppTest,
  setMetaTemplate,
} from '@rswim/domain-comms';
import { getTranslations } from 'next-intl/server';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PAGE = '/admin/integrations/whatsapp';

/** The owner connects (or replaces) the business's own number; the token and the secret are never echoed back. */
export async function connectWhatsAppAction(_: FormState, fd: FormData) {
  return runForm(fd, WhatsAppConnectInput, (tx, ctx, input) => connectWhatsApp(tx, ctx, input), {
    revalidate: [PAGE, '/admin/connections'],
    success: 'whatsapp.connected',
  });
}

export async function disconnectWhatsAppAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx) => disconnectWhatsApp(tx), {
    revalidate: [PAGE, '/admin/connections'],
    success: 'whatsapp.disconnected',
  });
}

/** Which approved Meta template carries one message outside the 24-hour window. */
export async function metaTemplateAction(_: FormState, fd: FormData) {
  return runForm(fd, MetaTemplateInput, (tx, ctx, input) => setMetaTemplate(tx, ctx, input), {
    revalidate: '/admin/messages/templates',
    success: 'whatsapp.templateSaved',
  });
}

/** "Check the connection": the worker asks Meta about the number and has its messages sent to us. */
export async function checkWhatsAppAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx, ctx) => requestWhatsAppCheck(tx, ctx), {
    revalidate: PAGE,
    success: 'whatsapp.live.checkAsked',
  });
}

/** Every message not yet at Meta goes to its review as a template. */
export async function submitMetaTemplatesAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx, ctx) => requestMetaTemplates(tx, ctx), {
    revalidate: PAGE,
    success: 'whatsapp.live.templatesAsked',
  });
}

/** A test message from the business's number to a phone the owner types. */
export async function testWhatsAppAction(_: FormState, fd: FormData) {
  const t = await getTranslations('whatsapp.live');
  return runForm(
    fd,
    z.object({ phone: z.string() }),
    (tx, ctx, { phone }) => sendWhatsAppTest(tx, ctx, { phone, text: t('testText') }),
    { revalidate: PAGE, success: 'whatsapp.live.testQueued' },
  );
}
