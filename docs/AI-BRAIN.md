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

## Stages

1. **Engine** (PR #26): gate, settings, journal and undo, the screens; the chat's moves, messages, makeup slots and
   payment links go through it.
2. **The parents' bot acts** (this PR): absence notices, makeup bookings and freezes, by level.
3. Requests from Reut and instructors (cancel a day and tell everyone, a sick instructor and a substitute), approval
   from Reut's WhatsApp.
4. The morning check acts (payment reminders, free seats to families waiting for a makeup, missing forms) and an
   evening summary.

Kinds not wired yet show as "soon" in the settings.
