# The business brain

One AI agent per school that answers people and acts through the ordinary domain services, with the owner deciding,
per kind of action, how much it may do on its own. The design Pit approved on 2026-11-03 is the Hebrew doc
"המוח של העסק: הצעת עיצוב"; this file is the engineering view.

It unifies what already existed: the owner copilot (Phase 9, now the brain's chat), the parents' WhatsApp bot (it acts
since stage 2), the inbox triage drafts and the insights feed.

## The gate

The model never writes data. It fills in an action (kind + params) through a `propose_*` tool. The action is checked
(Zod shape, then the module's own preview, e.g. the placement rules for a move), summarised from looked-up names, and
sent through `agentGate` (`packages/domain/copilot/src/agent-policies.ts`, pure, 100% covered):

| Level | What happens |
|---|---|
| `off` | Refused (`agent.errors.off`); the model tells the owner the action is off |
| `suggest` | Stored as a proposal; waits for the owner |
| `approve` | Stored as a proposal, ready to run on one tap |
| `auto` | Runs at once through the domain service, journaled as `ran_alone` (no decider) |

`auto` still waits for the owner when the brain is paused, when today's quota of actions on its own is used up
(`max_auto_per_day`), or when a payment link is above `max_auto_payment_agorot`; the wait reason is stored on the action.
`suggest` and `approve` behave the same in the owner's chat; they differ for the customer once the brain answers
families (stage 2: "passed to the office" vs "being handled").

Each kind has a ceiling (`AGENT_KIND_CEILING`): free text written by the model (`message_family`) and cancelling
lessons (`cancel_lessons`) never go above `approve`. Leaving, refunds and credits, and sensitive topics never reach
an action at all (the bot's existing hand-off rules).

## Settings

`agent_settings`, one row per school, owner only (RLS), audited. No row = the careful profile.

| Field | Default | Notes |
|---|---|---|
| `profile` | `careful` | `careful`, `balanced`, `autopilot`: ready-made tables |
| `levels` | `{}` | `{ kind: level }` the owner set; a missing kind takes the profile's level |
| `max_auto_per_day` | 30 | Actions on their own per day (Asia/Jerusalem) before the rest wait |
| `max_auto_payment_agorot` | 30000 | A payment link above this waits |
| `paused` | false | The stop switch |

These are operational switches the owner flips during the day (the stop switch must act at once), so they live in their
own table rather than in effective-dated `policy_sets`.

Profiles: **careful** runs only absence notices and reminders alone; **balanced** adds makeup bookings and payment
links; **autopilot** runs every kind up to its ceiling.

## The journal

Every action, from every channel, is a row in `copilot_actions` (kept under its Phase 9 name): `source`
(`owner_chat`, `parent_whatsapp`, `staff`, `morning_check`), `autonomy` (the level applied), `ran_alone`, the summary,
the result and its status (`proposed → confirmed | failed | dismissed`, `confirmed → undone`). Undo exists for moves (the
child returns), makeup slots (cancelled unless someone booked), payment links (cancelled unless paid), makeup bookings
(cancelled, the credit is open again) and freezes (cancelled). A message that went out cannot be unsent, and an
absence already decided the child's credit (the office voids a credit on the child's page). Actions the parents' bot
took keep the family's message (`inbound_message_id`), shown in the journal where the chat shows the owner's words.

Screens: `/admin/brain` (status and stop switch, what waits, profiles, the level table and caps), `/admin/brain/journal`
(filter by status, undo), and a "the brain is waiting for you" card on the owner's home.

## The parents' bot acts (stage 2)

With `comms.bot_enabled` on, the bot (`packages/domain/copilot/src/bot.ts`) has three action tools next to its read
tools. Each one checks that the child, credit or place belongs to the writing family, builds the summary from
looked-up names, and goes through `takeAction` with source `parent_whatsapp`:

| Tool | Kind | Domain service | Notes |
|---|---|---|---|
| `report_absence` | `report_absence` | `reportAbsence` (channel whatsapp, received when the family wrote) | Only a lesson that has not started; the regulations decide the makeup credit |
| `makeup_options` + `book_makeup` | `book_makeup` | `makeupOffers` / `bookMakeup` | Only clean fits: never a lesson the office would need to override a rule for |
| `request_freeze` | `freeze` | `requestFreeze` | From today on; still waits for the office when `billing.freeze_requires_approval` is on |

The tool answers `done`, `waiting` (the family is told the office confirms soon), `failed` (the rules refused; the
family is told why) or `not_allowed` (the kind is off; the bot hands the message to the office). The school's usual
confirmation templates (absence received, makeup confirmed) still go out when the action runs, including when the
owner approves it later.

The inbox drafts absences, makeup requests and freeze requests for the office's one tap. When the brain handles that
kind (its level is not off), the bot takes the message instead and the draft is set aside once the bot acted; when the
kind is off, the bot leaves the message to the draft as before. Receipt requests stay with the office.

## Requests from the owner and the instructors (stage 3)

**The owner's chat** has two more propose tools, with `find_venues` and `staff_lessons` to look things up:

| Tool | Kind | Domain service | Notes |
|---|---|---|---|
| `propose_cancel_lessons` | `cancel_lessons` | `createClosureEvent` + `openClosureEvent` | One day or a range, one venue or all. Sessions cancelled, credits by the regulations, `closure_notice` to the families. Always waits for the owner (ceiling); never undone from the journal (the closure screen handles what follows) |
| `propose_substitute` | `substitute` | `requestSubstitute` | One lesson that has not started. Qualified instructors get the offer in waves; the first to accept takes it and the families get `instructor_change`. Undo withdraws a search nobody took yet |

The summary of a cancellation counts the lessons it would cancel now; a range with none is refused. The makeup deadline
defaults to the last day of the month after the closure.

**An instructor's WhatsApp** (`brain-inbound.ts`, worker function `brain-inbound`): a message from a staff member's
phone saying they cannot teach ("אני חולה היום", "לא אוכל להגיע מחר", "לא אגיע ב-5.11"; no day means today) becomes one
`substitute` action per lesson they lead that day and that has not started, with source `staff` and the message in the
journal. The instructor gets one line back. With no lesson that day the message stays in the inbox for a person; with
substitutes off the brain stays out. Anything else a staff member writes stays in the inbox. Rules only, no model.

**Approvals on WhatsApp**: the owner sets a number on `/admin/brain` (`agent_settings.approval_phone_e164`). Every
action that waits and was not asked in the owner's own chat (a family's, an instructor's) is sent there with its number
(`copilot_actions.ref`, per school) and `כן 12` / `לא 12`. The answer from that number runs or drops the newest action
with that number, as the school's owner (`decided_by` is the owner's user), and the owner gets one line back (done,
refused by the rules, dropped, not found, already decided). The parents' bot never answers those messages. Like every
message, approval requests wait out quiet hours and Shabbat.

## The daily rounds (stage 4)

**Morning check** (`morning.ts`, worker function `brain-morning-check`, 07:00, after the insights feed at 06:30): the
brain acts on what the insights see, through the gate with source `morning_check`:

- A payment link for each family whose oldest unpaid charge reached `insights.debt_attention_days`, for its balance,
  largest first. Not again for a family it asked within that many days, nor for one holding an unpaid link.
- An instructor search (`substitute`, summary "למצוא מדריך/ה לשיעור…") for each lesson of the coming week with nobody
  to teach it, unless a search is already open or the owner dropped one for that lesson.

A kind the owner turned off proposes nothing. Under the careful profile everything waits, and with an approvals number
each waiting action goes to the owner's WhatsApp like any other. With insights off the morning check does nothing.

**Evening summary** (`brain-evening-summary`, 20:00): one WhatsApp to the approvals number with today's actions (done
alone, approved, still waiting, refused) and tomorrow's lessons and gaps. Once a day; the owner can turn it off on the
brain page (`agent_settings.evening_summary`). Like every message it waits out quiet hours and Shabbat.

Missing forms are not part of the swim school's morning check: the forms flow exists only in the freediving vertical.

## Stages

1. **Engine** (PR #26): gate, settings, journal and undo, the screens; the chat's moves, messages, makeup slots and
   payment links go through it.
2. **The parents' bot acts** (PR #27): absence notices, makeup bookings and freezes, by level.
3. **Requests from Reut and instructors** (PR #28): cancel a day and tell everyone, a sick instructor and a
   substitute, approval from Reut's WhatsApp.
4. **The daily rounds** (this PR): the morning check asks old debts to pay and finds instructors for uncovered
   lessons; the evening summary.

Kinds not wired yet show as "soon" in the settings.
