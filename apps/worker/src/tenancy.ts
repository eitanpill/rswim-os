/**
 * Which database a worker run uses (docs/TENANT-DATABASES.md).
 *
 * - A function about one school (its event carries `organizationId`) runs on that school's database: its own one
 *   when it has one, else the platform's.
 * - A scheduled sweep (cron, or an event without a school) runs once per database: the platform's first, then each
 *   school with its own database. Its step ids get the school's prefix so Inngest remembers each pass apart.
 * - Platform plumbing (`CONTROL_ONLY`: subscriptions, the platform's billing, setting up a school's database) always
 *   runs on the platform's database.
 *
 * `getDb()` reads the current database from AsyncLocalStorage, so function bodies did not have to change.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from '@rswim/db';
import type { Inngest } from 'inngest';

const scope = new AsyncLocalStorage<Db>();

export function currentDb(): Db | undefined {
  return scope.getStore();
}

/** Runs `fn` with `db` as the current database. */
export function withDatabase<T>(db: Db, fn: () => T): T {
  return scope.run(db, fn);
}

export const CONTROL_ONLY = new Set([
  'platform-school-created',
  'platform-bill-school',
  'platform-monthly-billing',
  'platform-daily',
  'platform-provision-database',
  'platform-sync-school',
]);

const STEP_METHODS = new Set([
  'run',
  'sleep',
  'sleepUntil',
  'waitForEvent',
  'sendEvent',
  'invoke',
  'waitForSignal',
]);

type AnyFn = (...a: unknown[]) => unknown;

/** The step tools with ids prefixed and every step body run inside `db`'s scope. */
export function scopedStep<S extends object>(step: S, db: Db, prefix: string): S {
  return new Proxy(step, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (typeof v !== 'function') return v;
      const fn = (v as AnyFn).bind(target);
      if (typeof prop !== 'string' || !STEP_METHODS.has(prop)) return fn;
      return (id: unknown, ...rest: unknown[]) => {
        const named =
          typeof id === 'string'
            ? prefix + id
            : id && typeof id === 'object' && 'id' in id
              ? { ...(id as object), id: prefix + String((id as { id: unknown }).id) }
              : id;
        if (prop === 'run' && typeof rest[0] === 'function') {
          const body = rest[0] as AnyFn;
          rest[0] = (...a: unknown[]) => scope.run(db, () => body(...a));
        }
        return fn(named, ...rest);
      };
    },
  });
}

export interface RoutingDeps {
  control: () => Db;
  forOrg: (orgId: string) => Promise<Db>;
  all: () => Promise<{ key: string; db: Db }[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The routed handler around a function's own handler. */
export function routeHandler<C extends { event?: { data?: unknown }; step: object }>(
  id: string,
  handler: (ctx: C) => unknown,
  deps: RoutingDeps,
) {
  return async (ctx: C) => {
    const once = (db: Db, prefix = '') =>
      scope.run(db, () => handler({ ...ctx, step: scopedStep(ctx.step, db, prefix) }));
    if (CONTROL_ONLY.has(id)) return once(deps.control());
    const data = ctx.event?.data as { organizationId?: unknown } | undefined;
    const orgId =
      typeof data?.organizationId === 'string' && UUID.test(data.organizationId)
        ? data.organizationId
        : null;
    if (orgId) return once(await deps.forOrg(orgId));
    const targets = await deps.all();
    if (targets.length <= 1) return once(targets[0]?.db ?? deps.control());
    const results: Record<string, unknown> = {};
    for (const t of targets) {
      results[t.key] = await once(t.db, t.key === 'control' ? '' : `school-${t.key.slice(0, 8)}:`);
    }
    return { databases: results };
  };
}

/** `inngest.createFunction` with routing (see the top of this file). */
export function routedFunction(client: Inngest) {
  return ((config: { id: string }, handler: (ctx: never) => unknown) =>
    client.createFunction(
      config as never,
      routeHandler(config.id, handler as never, {
        // Imported lazily: client.ts imports this module.
        control: () => lazy().controlDb(),
        forOrg: (orgId) => lazy().router().forOrg(orgId),
        all: () => lazy().router().all(),
      }) as never,
    )) as Inngest['createFunction'];
}

interface ClientHooks {
  controlDb: () => Db;
  router: () => {
    forOrg: (orgId: string) => Promise<Db>;
    all: () => Promise<{ key: string; db: Db }[]>;
  };
}
let clientModule: ClientHooks | undefined;
function lazy(): ClientHooks {
  if (!clientModule) throw new Error('worker client is not loaded');
  return clientModule;
}
/** client.ts registers itself here once loaded (avoids an import cycle at module load). */
export function registerClient(m: ClientHooks): void {
  clientModule = m;
}
