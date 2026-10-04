# Phase 7 — Parent Portal

## Goal
A family runs its own swimming life from the phone, without a WhatsApp to Reut: sign in with a one-time code,
see each child's lessons, report an absence, book the makeup it earns, ask for a freeze or to leave, pay, download
receipts, sign the regulations and forms, follow the child's progress, and show a digital companion pass at the pool
entrance.

## Acceptance criterion (from the brief)
1. **A parent completes absence → makeup booking → receipt download on a phone in under 60 seconds total.**
   A Playwright test on a phone viewport, signed in as the parent persona, reports an absence for the next lesson,
   the regulations issue the credit (the worker's step runs in between, as in production), books an offered makeup,
   opens payments and downloads a receipt, and the whole flow is measured under 60 seconds.

## What already exists (Phases 0–6)
Phone-code sign-in for parents, the family home (next lesson, open credits, forms due), the schedule with absence
reporting and makeup booking, payments (balance, payment links, standing order, history), and documents (forms to
accept).

## Scope

### 7.1 Database (migration `0014_portal`)
- `portal_requests`: a family's request to freeze a seat or to leave (enrollment, kind, dates, reason, note,
  requested at, status pending → done | refused | withdrawn, the resulting freeze or cancellation, the reason when
  refused). The database stamps who asked and when, so the cut-off is decided by the moment the family asked.
- RLS: a guardian inserts and reads requests only for their own children's seats, and may only withdraw a pending
  one; the office and the worker read and process them.

### 7.2 Services and worker
- `askFreeze` / `askCancellation` (the parent): record the request and emit `billing.portal_request_created`.
- `processPortalRequest` (the worker): runs the office's own `requestFreeze` / `requestCancellation` with the
  family's timestamp, so the same regulations decide; marks the request done or refused with the reason.
- `progressOf(student)`: the child's level, its skills and which are achieved, and the next level.
- Companion pass: a signed, dated token (HMAC from the master key) per child and day; a public verification page
  that needs no database.
- Receipts: the parent's receipt page and download route (the provider's PDF; a rendered copy under the fake
  provider).

### 7.3 Screens (parent, phone first)
- **Child card** (`/parent/child/[id]`): next lessons, progress by level, freeze or leave requests with their
  outcome, and the companion pass.
- **Companion pass**: the child, group, venue, today's lesson and how many companions may enter, a live clock and
  a QR code the entrance can scan.
- **Payments**: receipts open and download.
- Office: the worker turns each request into an ordinary freeze or leave request within seconds, so the office sees
  it on the existing **כספים › הקפאות** and seat screens (with the approval the regulations ask for).

### 7.4 Seed, tests, docs
- Receipts issued (fake provider) for September's payments, so the Cohens have one to download.
- E2E for the acceptance criterion, plus freeze and pass flows; RLS rows for the new table.
- POLICIES, DECISIONS, STATUS, `docs/demos/PHASE-7.md`.
