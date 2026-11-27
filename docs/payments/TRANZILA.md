# Tranzila

A business's own processor (`packages/integrations/src/tranzila.ts`), written from Tranzila's documentation
(`https://docs.tranzila.com`, read 2026-11-27: API authentication, handshake v2, the DirectNG hosted page, the
transactions API and the reports API) and tested against recorded answers in
`packages/integrations/test/tranzila.test.ts`. No test talks to Tranzila. A terminal with Tranzila's invoices module
issues the receipt for each payment, so we never issue one for those (`docs/PAYMENTS.md`, Receipts).

## Connecting

| Who | Where | What | Switch |
| --- | --- | --- | --- |
| The owner | `/admin/integrations/payments` or `/dive/payments` → Tranzila | Terminal name, and the API application key and secret (my.tranzila → API; both shown only by their last 4 characters). Sealed with the school's data key | `RSWIM_TRANZILA_LIVE=1` on web and worker. Without it the connection is saved as "not live yet" and nothing is charged |

In a sandboxed process (`RSWIM_PAYMENTS_SANDBOX`, `RSWIM_GROW_FAKE`, `RSWIM_DEMO_MODE`) the demo processor still wins,
so local runs, CI, staging and the live demo never call Tranzila.

## How each flow maps onto Tranzila

API calls carry `X-tranzila-api-app-key`, `X-tranzila-api-request-time` (Unix seconds), `X-tranzila-api-nonce` (80 hex
characters) and `X-tranzila-api-access-token` = HMAC-SHA256 of the app key under `secret + time + nonce`, lowercase hex.

| Ours | Tranzila |
| --- | --- |
| Connection check (on save) | `POST api.tranzila.com/v2/handshake/create` for ₪1, a page nobody pays |
| Card checkout | a handshake for the exact sum (`thtk`, 20 minutes), then `directng.tranzila.com/<terminal>/iframenew.php` with `tranmode=A`, `sum`, `currency=1`, the three return URLs (`success_url_address`, `fail_url_address`, `notify_url_address`), our reference in `rswim_ref` and at the end of `pdesc` |
| Bit checkout | the same page with `bit_pay=1` |
| Standing-order checkout | `tranmode=A` when there is an amount now (the Token module leaves a token), `tranmode=N` (a J2 check of ₪1, not charged, `hidesum`) when not |
| Notify | Tranzila posts the transaction to `notify_url_address` (`/api/webhooks/pay/<connectionId>`). **Not signed and not trusted**: we read only `index` and our reference, then `POST report.tranzila.com/v1/transaction` with our terminal and that `transaction_index`, and take the result (`processor_response_code` "000"), the amount, the token and its expiry from Tranzila's own report. The handshake makes Tranzila refuse a page paid for another sum |
| Monthly charge of a saved card | `POST api.tranzila.com/v1/transaction/credit_card/create`, `txn_type: debit`, the token as `card_number` with its expiry, and `DCdisable` (a hash of our idempotency key) so Tranzila refuses a repeat within 24 hours when the terminal is set up for it. A charge whose answer was lost is still **not** sent again: the payment stays pending (`tranzila_unconfirmed`) for the office |
| Refund | in Tranzila: a credit needs the card's token and the charge's authorization number |
| Cancel a standing order | nothing to call: a token is charged only when we ask |

A saved card is kept as the mandate id `tranzila:<token>:<MMYY>`.

## What the owner needs from Tranzila

1. A terminal with the DirectNG hosted page, the API module (app key and secret), and the reports API.
2. The Token module, for standing orders; Bit turned on, to offer Bit; the invoices module, for receipts.
3. Handshake enabled on the iFrame (Settings → Terminal → iFrame → Advanced), so a page can't be paid for less.
4. `DCdisable` set up as Tranzila's duplicate check ("field 20 only"), so a repeated monthly charge is refused.

## Not verified yet (try on a test terminal before `RSWIM_TRANZILA_LIVE=1`)

1. The notify echoes our `rswim_ref` field, or at least `pdesc` (Tranzila documents only its own fields).
2. The notify's `index` is the reports API's `transaction_index`, and the report returns the token and expiry.
3. A charge with `tranmode=A` on a Token-module terminal leaves a token (`credit_card_token` in the report).
4. The token charge's `items` shape (`name`, `type`, `unit_price`, `units_number`) and its answer.
5. Bit with `bit_pay=1`, and a J2 check (`tranmode=N`) reporting amount 1.
6. The access token formula against a known-good call (the docs say both "40 bytes" and "80 hex characters" for the nonce).
