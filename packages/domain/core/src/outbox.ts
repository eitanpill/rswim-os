import { randomUUID } from 'node:crypto';
import { DomainEventEnvelope } from '@rswim/contracts';
import { schema, sql, type Tx } from '@rswim/db';

export interface EmitInput {
  organizationId: string;
  type: string;
  payload: Record<string, unknown>;
  /** Business-level key: the same key for the same fact, so retries of a mutation emit once. */
  idempotencyKey: string;
}

/**
 * Records a domain event in the SAME transaction as the change it announces (ADR-0002).
 * Emitting the same idempotency key twice for an org keeps the first event.
 */
export async function emit(tx: Tx, input: EmitInput): Promise<string> {
  const id = randomUUID();
  const envelope = DomainEventEnvelope.parse({
    id,
    organizationId: input.organizationId,
    type: input.type,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
    occurredAt: new Date().toISOString(),
  });
  // No RETURNING and no conflict target: both would require a SELECT policy, and signed-in users may
  // insert into the outbox but never read it. The only other unique key is the random id.
  await tx
    .insert(schema.outbox)
    .values({
      id: envelope.id,
      organizationId: envelope.organizationId,
      eventType: envelope.type,
      payload: envelope.payload,
      idempotencyKey: envelope.idempotencyKey,
    })
    .onConflictDoNothing();
  return id;
}

/** Writes an app-level audit entry (e.g. login, policy override) as the current user, for the current org. */
export async function recordAudit(
  tx: Tx,
  entry: {
    organizationId: string;
    actorId: string | null;
    action: string;
    subjectType: string;
    subjectId?: string;
    diff?: unknown;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into audit_log (organization_id, actor_id, action, subject_type, subject_id, diff)
    values (${entry.organizationId}, ${entry.actorId}, ${entry.action}, ${entry.subjectType},
            ${entry.subjectId ?? null}, ${entry.diff === undefined ? null : JSON.stringify(entry.diff)}::jsonb)
  `);
}
