import { createDb, createPool } from '@rswim/db';
import type { EventSender } from '@rswim/domain-core/worker';
import { Inngest } from 'inngest';
import pino from 'pino';
import { env } from './env';

export const log = pino({ name: 'rswim-worker', level: process.env.LOG_LEVEL ?? 'info' });

export const inngest = new Inngest({ id: 'rswim-os' });

let db: ReturnType<typeof createDb> | undefined;
export function getDb() {
  db ??= createDb(createPool(env('DATABASE_URL')));
  return db;
}

/** Hands outbox events to Inngest. Inngest dedupes on `id`, so a resend after a crash is harmless. */
export const inngestSender: EventSender = {
  async send(event) {
    await inngest.send({
      id: event.id,
      name: event.type,
      data: {
        organizationId: event.organizationId,
        idempotencyKey: event.idempotencyKey,
        occurredAt: event.occurredAt,
        payload: event.payload,
      },
    });
  },
};
