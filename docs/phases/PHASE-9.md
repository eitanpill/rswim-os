# Phase 9 — Reports, Venue Migration Wizard, owner copilot

## Goal
Give the owner the numbers to run the school (money, occupancy, venue margins, churn and its reasons, the trial
funnel), make "the pool is closing" a guided half-hour job instead of a week of phone calls, and let the owner ask for
things in plain Hebrew without bypassing the rules.

## Acceptance criterion (from the brief)
1. **Migrating all groups from a closing venue to another produces a preview, personalized messages, and is
   reversible within 24h.**
   A Playwright test signs in as the owner and opens the wizard for the demo Gush Etzion pool. It maps each group
   (keeping the group and moving it to the Jerusalem country club, or folding it into an existing group there) and
   sees the preview: rule checks per child, the price change and one personal message per child. It then executes
   and sees the families' messages queued. Finally it reverts, and the groups, places and lessons are back as they
   were, with a "the change was cancelled" message queued.

## Scope

### 9.1 Venue Migration Wizard (brief §6.2)
- Tables: `venue_migrations` (source venue, effective date, reason, status draft → executed → reverted, revert
  deadline) and `venue_migration_items` (one per source group: the target, plus a snapshot of everything execution
  changed, so it can be undone).
- Each source group is mapped one of two ways:
  - **relocate**: the same group moves to another venue/pool/lanes (time may shift on the same weekday). Its children,
    freezes, cancellations and history stay as they are. Lessons from the date move with it.
  - **merge**: its children join an existing group at another venue. Suggestions are ranked by a pure policy on
    program, age band, gender, level, weekday and time similarity, and free seats, with the reasons shown.
- Preview: hard rules for every relocated group (window, gender, lanes, instructor) checked against the timetable as
  it will be, and placement rules for every child who joins a group. The monthly price before and after
  (`price_lists` per venue), lessons with bookings that block the change, and the personal message for every child.
  Execution is refused while anything blocks.
- Execute: one transaction applies the change and emits `scheduling.venue_migrated`. The comms automation
  (`venue_migration` template, editable) sends each family its personal message. The revert window is
  `migration.revert_hours` (default 24).
- Revert: inside the window, the snapshot is replayed backwards (groups, lanes, places and lessons back as they
  were) and `scheduling.venue_migration_reverted` sends `venue_migration_reverted`. Places that billing already
  charged block the revert.

### 9.2 Reports (brief §6.14, §6.2 profitability)
- A read-only `reports` module. Pure policies (100% coverage) cover venue margin, occupancy, churn buckets, funnel
  conversion and instructor KPIs.
- Screens under `/admin/reports`:
  - **Revenue**: charged and collected per month, per venue and program.
  - **Venue profitability**: revenue attributed to the venue (family charges for its groups plus institution
    invoices) against rent (`venue_contracts`) and instructor cost (payroll lines of its lessons). Margin per venue
    per month, and seat utilization.
  - **Occupancy heatmap**: venue × weekday × hour, seats held / capacity.
  - **Churn**: places that ended per month, by structured reason. A required reason (cold water, schedule, fear,
    moving, cost, level done, other) is added to cancellations from the office and the parent portal.
  - **Funnel**: new families → trial booked → trial held → enrolled, by source and branch, with median days to
    enroll.
  - **Instructor KPIs**: lessons taught, lessons covered by a substitute, children kept after 3 months.
- Every table exports to CSV (UTF-8 with BOM so Excel shows Hebrew).

### 9.3 Owner copilot (brief §6.15)
- `/admin/copilot`: the owner writes a request in Hebrew. The model (Claude through `@anthropic-ai/sdk`, or a
  rules-based fake for demos and tests) may call read tools: find children and groups, debts, today's lessons and
  closures. It can only *propose* actions: move a child to a group, message a family, open makeup slots.
- Proposals are stored (`copilot_requests`, `copilot_actions`). Nothing happens until the owner taps confirm. The
  action then runs through the same domain service, as the owner, under RLS and the same policies, and is written
  to the audit log. A confirmed move can be undone from the same screen.
- Off by default: the `copilot.enabled` policy plus `ANTHROPIC_API_KEY` in the web app, or `RSWIM_COPILOT_FAKE=1`.

### 9.4 Weekly digest (brief §6.15)
- Every Sunday at 07:00 the worker builds the week's digest from the reports with a pure policy. It covers what
  happened, what needs attention, and suggestions: open a group where the waitlist clusters, raise a price where
  occupancy is above 90%, a venue losing money, debts aging.
- The digest is stored (`weekly_digests`) and shown on `/admin/reports/digest`.

## Out of scope / later
- XLSX export (CSV opens in Excel), seasonality forecast, parent feedback scores (no feedback data yet).
- Copilot actions beyond the three above. Free-form SQL is never offered.
