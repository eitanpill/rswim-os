# Payments through the business's own processor

Each business (a swim school, a dive club) connects **its own** payment processor (סליקה) in the app, and its
customers pay it in one tap: by credit card, by Bit, or by setting up a standing order (הוראת קבע). The money goes
through the business's processor into the business's account; the platform never holds card numbers.

## Who does what

| Who | Where | What |
| --- | --- | --- |
| Owner | `/admin/integrations/payments` (swim), `/dive/payments` (club; link on the owner's bridge) | Picks the processor, pastes its API keys, ticks which ways customers may pay, disconnects |
| Office | same screen (read only) | Sees whether a processor is connected; payment links it sends become payment pages |
| Family | `/parent/payments` | "Pay by card / Bit" for the balance, "set up a standing order" (or replace its card) |
| Diver | `/dive/me/pay/<booking>`, `/dive/me/pay/pass/<kind>` | Card or Bit for a booking or a pass |
| Anyone with a link | `/pay/<token>` (public) | The business's payment page from a WhatsApp link: card, Bit, standing order |

## How it works

1. **Connection** (`payment_connections`, one per business, owner-only RLS). The keys are sealed with the business's
   data key (`enc_credentials`, ADR-0005); signed-in users cannot select them, not even the owner. Only the business's
   system role opens them (`loadGateway`). Saving runs the processor's `testConnection`; a processor whose adapter is
   not live yet is saved as `failed` with `adapter_not_live`, and nothing is ever charged through it. A business that
   connected a processor never falls back to the worker-wide `RSWIM_GROW_FAKE` provider.
2. **Adapters** (`packages/integrations/src/gateways.ts`). `PaymentGateway` = the monthly billing's `PaymentProvider`
   (standing-order charges, links, refunds, mandate cancel) + `createCheckout` (hosted page for a card, Bit or a new
   standing order) + `readWebhook` (verify, then normalize the callback). `PAYMENT_GATEWAYS` lists Grow, Cardcom,
   Tranzila and PayPlus with the fields each asks for. Adding a processor = one adapter class + its spec entry.
3. **Checkouts** (`checkouts`): one amount and what it pays for (`household`, `mandate`, `dive_booking`, `dive_pass`,
   `lodging_stay`),
   with a long random token that is the customer's only key. Tapping a method opens the processor's page
   (idempotency key `checkout:<id>:<method>`).
4. **Callback** `POST /api/webhooks/pay/<connectionId>`: the connection names the business; its own gateway verifies
   the callback; it is stored once by the processor's event id (`webhook_events`, provider `gateway:<connectionId>`)
   and applied at once in the business's scope. A family checkout records a provider payment (ledger, link, dunning,
   receipt as for any payment); a saved card becomes the family's standing order (an older one is cancelled) on the
   regulations' run day; a dive checkout confirms the booking or issues the pass, and a lodging checkout records the
   booking's payment (both through the module hook `onModulePaid`). A wrong amount is refused
   (`amount_mismatch`); a forged callback gets 401; a failed apply is forgotten so the processor's retry applies it.
5. **Worker**: billing runs, dunning retries, refunds, mandate cancels and payment links resolve the business's own
   gateway (`tenantPaymentProvider`). A link becomes `RSWIM_PUBLIC_URL/pay/<token>`.

## Sandbox (local, CI, the live demo)

With `RSWIM_PAYMENTS_SANDBOX=1`, `RSWIM_GROW_FAKE=1` or `RSWIM_DEMO_MODE=1`, every processor runs as the demo
processor: its hosted page is our `/pay/<token>/sandbox` (a card form, a Bit request, or a card saved for a standing
order), whose approve/decline sends a callback signed with the business's webhook secret through the very same
intake. The seed connects R-SWIM (card, Bit, standing order) and the Eilat club (card, Bit) to "Grow" with invented
keys. Without sandbox mode the demo processor never runs.

## Cardcom (the first real adapter)

`packages/integrations/src/cardcom.ts`, written from Cardcom's API v11 and tested against recorded answers; details,
the test plan and what is still unverified are in `docs/payments/CARDCOM.md`. It serves a business that connects its
own Cardcom terminal (live only with `RSWIM_CARDCOM_LIVE=1`) and the platform's own terminal for the subscription
card and monthly charges (`PLATFORM_CARDCOM_*`).

## Grow (Meshulam)

`packages/integrations/src/grow-gateway.ts`, written from Grow's documentation (developers.grow.business) and tested
against answers in its documented shapes; details and the sandbox test plan are in `docs/payments/GROW.md`. A business
connects its own Grow (user id, card page code, and its Bit page code when Grow opened Bit); the platform's key from
Grow is `GROW_PLATFORM_API_KEY`. Live only with `RSWIM_GROW_LIVE=1` (`GROW_SANDBOX=1` points it at Grow's sandbox).

## Going live with a real processor (needs Pit / the business)

- Which processor the business uses, and a **sandbox (test) account** at that processor.
- Write its adapter against the processor's documentation and test it in the sandbox: hosted page per method
  (card, Bit, recurring/token), callback verification, token charge, refund, cancel. Then flip `live: true`.
- `RSWIM_MASTER_KEY` in both web and worker; `RSWIM_PUBLIC_URL` in the worker (the links in WhatsApp).
- The owner enters the keys on the connection screen. Keys never go in chat or the repo.

Known gap: if a dive booking's hold lapsed and the seat was taken while the diver was on the processor's page, the
callback cannot confirm it; the processor retries and the office has to refund by hand.

## Receipts

The processor issues the receipt for every payment it takes; we don't issue a second one (the worker skips payments
with `source = 'provider'`). Payments the office records by hand (cash, transfer, cheque) get their receipt from the
business's own Morning account when it connected one on `/admin/integrations/receipts` (`/dive/receipts`). See
`docs/payments/MORNING.md`.
