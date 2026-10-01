/**
 * Worker-side outbox machinery: the relay that hands events to the job runner, and the inbox guard that
 * makes every consumer idempotent. Exactly-once *effects* = at-least-once delivery + idempotent consumers.
 */
import type { DomainEventEnvelope } from '@rswim/contracts';
import { sql, type Db, type Tx } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';

export interface EventSender {
  /** Must be idempotent on `event.id` (Inngest dedupes on the event id). */
  send(event: DomainEventEnvelope): Promise<void>;
}

export interface RelayOptions {
  batchSize?: number;
  maxAttempts?: number;
  /** Delay before retry number `attempt` (1-based), in ms. */
  backoffMs?: (attempt: number) => number;
}

export interface RelayResult {
  dispatched: number;
  failed: number;
  deadLettered: number;
}

const defaultBackoff = (attempt: number) => Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);

type OutboxRow = {
  id: string;
  organization_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  created_at: Date;
  attempts: number;
};

/**
 * Claims due outbox rows (FOR UPDATE SKIP LOCKED, so several relays can run), sends each, and marks it.
 * Cross-tenant by nature, so it uses the platform connection; it only touches the outbox and dead letters.
 */
export async function relayOnce(
  db: Db,
  sender: EventSender,
  options: RelayOptions = {},
): Promise<RelayResult> {
  const { batchSize = 50, maxAttempts = 8, backoffMs = defaultBackoff } = options;
  const result: RelayResult = { dispatched: 0, failed: 0, deadLettered: 0 };

  await asPlatform(db, async (tx) => {
    const { rows } = await tx.execute<OutboxRow>(sql`
      select id, organization_id, event_type, payload, idempotency_key, created_at, attempts
      from outbox
      where dispatched_at is null and available_at <= now()
      order by created_at
      limit ${batchSize}
      for update skip locked
    `);

    for (const row of rows) {
      const event: DomainEventEnvelope = {
        id: row.id,
        organizationId: row.organization_id,
        type: row.event_type,
        payload: row.payload,
        idempotencyKey: row.idempotency_key,
        occurredAt: new Date(row.created_at).toISOString(),
      };
      try {
        await sender.send(event);
        await tx.execute(
          sql`update outbox set dispatched_at = now(), attempts = attempts + 1, last_error = null where id = ${row.id}`,
        );
        result.dispatched++;
      } catch (err) {
        const attempts = row.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        if (attempts >= maxAttempts) {
          await tx.execute(sql`
            update outbox set attempts = ${attempts}, last_error = ${message}, available_at = 'infinity' where id = ${row.id}
          `);
          await tx.execute(sql`
            insert into dead_letters (organization_id, source, ref_id, payload, error)
            values (${row.organization_id}, 'outbox', ${row.id}, ${JSON.stringify(event)}::jsonb, ${message})
          `);
          result.deadLettered++;
        } else {
          await tx.execute(sql`
            update outbox set attempts = ${attempts}, last_error = ${message},
              available_at = now() + make_interval(secs => ${backoffMs(attempts) / 1000})
            where id = ${row.id}
          `);
          result.failed++;
        }
      }
    }
  });
  return result;
}

/**
 * Runs `handler` at most once per (consumer, event), even if the event is delivered many times.
 * The receipt and the handler's writes commit in one org-scoped transaction, so a crash leaves neither.
 * Returns false when the event had already been handled.
 */
export async function consumeOnce(
  db: Db,
  consumer: string,
  event: DomainEventEnvelope,
  handler: (tx: Tx, event: DomainEventEnvelope) => Promise<void>,
): Promise<boolean> {
  return withOrg(db, event.organizationId, async (tx) => {
    const { rows } = await tx.execute(sql`
      insert into inbox_receipts (consumer, event_id, organization_id)
      values (${consumer}, ${event.id}, ${event.organizationId})
      on conflict do nothing
      returning event_id
    `);
    if (rows.length === 0) return false;
    await handler(tx, event);
    return true;
  });
}
