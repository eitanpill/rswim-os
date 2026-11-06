import { createDb, createPool, type Db } from '@rswim/db';
import { DatabaseRouter, masterKeyFromEnv } from '@rswim/db/tenants';
import type { EventSender } from '@rswim/domain-core/worker';
import { Inngest } from 'inngest';
import pino from 'pino';
import { env } from './env';
import { currentDb, registerClient, routedFunction } from './tenancy';

export const log = pino({ name: 'rswim-worker', level: process.env.LOG_LEVEL ?? 'info' });

/** The real Inngest client (the server registers functions with it). */
export const inngestClient = new Inngest({ id: 'rswim-os' });

/**
 * The client every function file uses. Its `createFunction` routes each run to the right database: a school's own
 * one for its events, every database in turn for scheduled sweeps (docs/TENANT-DATABASES.md).
 */
export const inngest = new Proxy(inngestClient, {
  get(target, prop, receiver) {
    if (prop === 'createFunction') return routedFunction(target);
    const v = Reflect.get(target, prop, receiver) as unknown;
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
}) as Inngest;

let control: Db | undefined;
/** The platform's own database (DATABASE_URL). */
export function controlDb(): Db {
  control ??= createDb(createPool(env('DATABASE_URL')));
  return control;
}

let routerInstance: DatabaseRouter | undefined;
export function router(): DatabaseRouter {
  routerInstance ??= new DatabaseRouter(controlDb(), { masterKey: () => masterKeyFromEnv() });
  return routerInstance;
}

/** The database of the school this run works for (the control plane outside a routed run). */
export function getDb(): Db {
  return currentDb() ?? controlDb();
}

/** Hands outbox events to Inngest. Inngest dedupes on `id`, so a resend after a crash is harmless. */
export const inngestSender: EventSender = {
  async send(event) {
    await inngestClient.send({
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

registerClient({ log, inngestClient, inngest, controlDb, router, getDb, inngestSender });
