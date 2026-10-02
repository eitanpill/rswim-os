import { z } from 'zod';

/** Every domain event carried by the outbox (ADR-0002). */
export const DomainEventEnvelope = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  type: z
    .string()
    .regex(/^[a-z]+(\.[a-z_]+)+$/, 'event types look like "module.something_happened"'),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type DomainEventEnvelope = z.infer<typeof DomainEventEnvelope>;

/** Test event used by the Phase 0 exactly-once acceptance test. */
export const CorePing = z.object({ message: z.string() });
export type CorePing = z.infer<typeof CorePing>;
