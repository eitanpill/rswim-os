# Phase 5 — Communications Hub

## Goal
Families hear from the school without Reut typing. Every message the system sends comes from an editable Hebrew
template, goes through one outbound queue that respects quiet hours and never sends on Shabbat or a holiday, and is
logged whether it was sent, held or blocked. Messages families write on WhatsApp land in an inbox that already knows
what they want: "דניאל לא יגיע היום" from a known parent arrives as a ready absence notice the office approves with
one tap. Broadcasts reach a segment (a venue, a group, a program, families who owe), and the holiday notice ("אין
שיעורים בחול המועד") goes out by itself before every holiday.

## Acceptance criteria (from the brief)
1. **"דניאל לא יגיע היום" from a known guardian becomes a pre-filled absence action in under 5 seconds.** A GHL
   InboundMessage webhook from a guardian's phone is stored, matched to the guardian and household, classified, and
   turned into a draft absence action for the right child and today's lesson, in the same request. The integration
   test measures webhook-to-action time; the E2E test posts the signed webhook and finds the action in the inbox,
   then approves it and sees the absence recorded with the regulations' decision.
2. **Nothing is sent on Shabbat.** The dispatcher decides at send time, with the calendar's rest windows (candle
   lighting − 30 min to havdalah + 30 min, Yom Tov included) and quiet hours. A fast-check property over random
   instants shows no message is ever handed to the provider inside a rest window; integration tests queue messages on
   a Friday afternoon and see them held until Saturday night, then sent.
3. **Every outbound is logged.** Each message, sent, held, failed or blocked (opted out, no phone, missing variable),
   is a row in `messages` with its template, rendered text, recipient, the event that caused it and the provider's
   id. The test sends through every path and checks the log; the provider is never called without a row.

## Scope

### 5.1 Database (migrations `0010_comms` + `0011_comms_security`)
- `message_templates`: key, locale, channel, body with `{{variables}}`, GHL template id (for messages outside the
  24-hour window), active. Seeded per organization with the brief's set, warm tone included; the owner edits them.
- `automation_rules`: event type → template key, enabled, delay minutes. The defaults wire the domain events of
  Phases 2–4 to their templates; the owner turns each on or off.
- `messages` (the outbound log and queue): recipient guardian and phone, template key, rendered text, status
  (queued, held, sent, failed, blocked), not-before time, hold reason, block reason, source event id, broadcast id,
  provider message id, idempotency key.
- `inbound_messages`: GHL message id, phone, matched guardian and household, text, received at, classification
  (intent, confidence, entities, classifier and version), status (new, actioned, dismissed, needs_human).
- `triage_actions`: the draft action an inbound message produced (absence notice, makeup request, freeze request,
  cancellation request…), its pre-filled payload, status (pending, approved, dismissed), who decided and the record it
  created.
- `broadcasts`: segment definition, template or free text, scheduled time, status, counts.
- RLS: owner and admin manage everything; the tenant's worker writes; parents read their own household's messages.

### 5.2 Pure policies (`packages/domain/comms/src/policies.ts`, 100% branch coverage)
- `sendDecision(instant, rules)`: send now, or hold until the end of quiet hours or the rest window, with the reason.
- `renderTemplate(body, vars)`: the text, or the missing variables (a message with a missing variable is blocked,
  never sent half-filled).
- `classifyInbound(text, context)`: a deterministic Hebrew classifier for the brief's intents (absence notice, makeup
  request, schedule question, payment question, receipt request, cancellation, freeze, lead, complaint, instructor
  message, personal/other), with the child's name matched against the household and the day ("היום", "מחר",
  weekdays, dates). It is the baseline and the fallback for the AI classifier.
- `triageDecision(classification, rules)`: a draft action for high-confidence intents; complaints, cancellations and
  low confidence go to a person; personal/other never gets an automatic reply.
- `holidayNotice(today, rules)`: the next run of days without lessons (Chol HaMoed, Yom Tov) that needs a notice.
- `matchesSegment(recipient, segment)`.

### 5.3 Services and worker
- Automations: one consumer per mapped event type renders the template for the household's guardians and queues
  messages (idempotent per event and guardian).
- Dispatcher (worker cron, every minute): sends due messages through `MessagingProvider`, checking the send decision
  again at send time, at most `comms.rate_per_minute`.
- Inbound intake: the GHL webhook route recognises InboundMessage, stores it, classifies it and creates the draft
  action in one request. With `comms.ai_triage` on and an API key set, the worker re-classifies with Claude (strict
  JSON) and replaces a lower-confidence draft.
- Broadcasts: preview the audience, send now or schedule; opted-out guardians are blocked and logged.
- Holiday notice: daily cron sends the template to every active family before a no-lesson stretch, once per stretch.
- GHL pipeline sync: a booked trial and a converted trial move the guardian's opportunity to the configured stages.

### 5.4 Integrations
- `GhlMessagingProvider` (conversations API, WhatsApp) behind `MessagingProvider`; `FakeMessagingProvider` for tests
  and demos (`RSWIM_MESSAGING_FAKE=1`).
- `ClaudeTriageClassifier` behind `TriageClassifier`, used only when configured; tests use the rules classifier.

### 5.5 Screens
- **הודעות › תיבה נכנסת**: inbound messages with their intent, the pre-filled action and one-tap approve or dismiss,
  and a reply box (inside the 24-hour window).
- **הודעות › יומן**: every outbound message with status and reason; filter by status.
- **הודעות › תבניות** and **אוטומציות**: edit templates, turn automations on and off.
- **הודעות › הודעה לקבוצה**: segment, preview count, send now or schedule.
- Policy editor: the new `comms.*` keys.

## Policy keys added
`comms.rate_per_minute` (20), `comms.holiday_notice_days_before` (2), `comms.ai_triage` (false),
`comms.triage_min_confidence` (0.8).

## Out of scope (logged in DECISIONS)
- Lesson reminders 2 hours before and the evening lineup message to instructors: the template exists, the scheduler
  arrives with the instructor app's notifications in Phase 6.
- Update-group registry (WhatsApp groups per venue): GHL has no API for group membership; Phase 7 portal link.
