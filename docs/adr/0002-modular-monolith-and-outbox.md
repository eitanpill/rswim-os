# ADR-0002: Modular monolith with domain events and transactional outbox

- Status: Accepted
- Date: 2026-10-01

## Context
The domain is wide (venues, scheduling, enrollment, attendance, billing, payroll, comms, transport) but the team is tiny. Many actions must trigger side effects (WhatsApp messages, charges, GHL sync, receipts) that must happen **exactly once** and **never be lost**, even when an external API is down. The data shows real damage from duplicates and silent failures (double standing orders, failed charges unnoticed for months).

## Decision
1. **Modular monolith.** One deployable, strict modules under `packages/domain/<module>/`:
   - `schema.ts` (Drizzle tables owned by the module)
   - `policies.ts` (pure rule functions, no I/O)
   - `services.ts` (orchestration; the only public write API)
   - `events.ts` (event types + Zod payloads)
   - `api.ts` (tRPC router)
   A module may import another module's `services` or `events`, never its `schema`. Enforced with an ESLint boundaries rule.
2. **Domain events + transactional outbox.** Every service mutation writes its rows and an `outbox` row (`id, organization_id, event_type, payload, idempotency_key, created_at, dispatched_at, attempts, last_error`) in the same DB transaction.
3. **Relay.** The worker claims undispatched rows with `FOR UPDATE SKIP LOCKED`, sends each to Inngest with `id = outbox.id` (Inngest dedupes on event id), marks `dispatched_at`. Inngest functions are written idempotently and keyed on business ids.
4. **Consumers record receipts.** `inbox_receipts(consumer, event_id)` unique constraint makes each consumer process an event at most once, even on redelivery.
5. **External calls** carry an idempotency key derived from `(event_id, step)`. Failures retry with backoff; exhausted retries go to `dead_letters`, surfaced in an "Integrations Health" admin screen.
6. **Inbound webhooks** (Grow, GHL) are stored raw in `webhook_events` with a unique `(provider, external_id)` before processing.

## Consequences
- Exactly-once effect = at-least-once delivery + idempotent consumers. Tests must prove a duplicate delivery produces one effect.
- Slight latency (relay poll ~1s, plus a direct nudge after commit).
- Modules can be extracted later if ever needed, because boundaries are already enforced.
