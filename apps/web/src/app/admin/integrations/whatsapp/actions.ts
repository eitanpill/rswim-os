'use server';

import { z } from 'zod';
import { MetaTemplateInput, WhatsAppConnectInput } from '@rswim/contracts';
import { connectWhatsApp, disconnectWhatsApp, setMetaTemplate } from '@rswim/domain-comms';
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
