# PayPlus

A business's own processor (`packages/integrations/src/payplus.ts`), written from PayPlus's REST API v1.0 reference
(`https://docs.payplus.co.il`, read 2026-11-27) and tested against recorded answers in
`packages/integrations/test/payplus.test.ts`. No test talks to PayPlus. PayPlus issues the receipt for each payment
(its Invoice+ module), so we never issue one for those (`docs/PAYMENTS.md`, Receipts).

## Connecting

| Who | Where | What | Switch |
| --- | --- | --- | --- |
| The owner | `/admin/integrations/payments` or `/dive/payments` → PayPlus | API key and secret key (both shown only by their last 4 characters), the payment page's uid, the terminal's uid and the cashier's uid, all from PayPlus's dashboard. Sealed with the school's data key | `RSWIM_PAYPLUS_LIVE=1` on web and worker (`PAYPLUS_STAGING=1` points it at `restapidev.payplus.co.il`). Without it the connection is saved as "not live yet" and nothing is charged |

In a sandboxed process (`RSWIM_PAYMENTS_SANDBOX`, `RSWIM_GROW_FAKE`, `RSWIM_DEMO_MODE`) the demo processor still wins,
so local runs, CI, staging and the live demo never call PayPlus.

## How each flow maps onto PayPlus

Every call goes to `https://restapi.payplus.co.il/api/v1.0/` with the `api-key` and `secret-key` headers.

| Ours | PayPlus |
| --- | --- |
| Connection check (on save) | `GET PaymentPages/list/?terminal_uid=…`: the keys work and the payment page is on that terminal |
| Card checkout | `PaymentPages/generateLink`, `charge_method: 1` (J4), only the card tab, `initial_invoice: true`, redirect to `payment_page_link` |
| Bit checkout | the same page with only the Bit tab (`charge_default` and `allowed_charge_methods: ['bit']`) |
| Standing-order checkout | `charge_method: 1` with `create_token: true` when there is an amount now, `charge_method: 5` (token check, J2, nothing charged) when not |
| Callback | PayPlus posts to `refURL_callback` (`/api/webhooks/pay/<connectionId>`), failures too (`send_failure_callback`). Signed: the `hash` header is base64 HMAC-SHA256 of the body under the secret key, with user agent `PayPlus`; we check the raw body, then the body serialized again (PayPlus's sample). Then we read `transaction` (approved = `status_code` "000") and our `more_info` (`<checkout id>\|<method>`) |
| Monthly charge of a saved card | `Transactions/Charge` with `use_token`, `token`, `customer_uid`, the terminal and cashier, `initial_invoice: true`. PayPlus documents no idempotency key, so a charge whose answer was lost is **not** sent again: the payment stays pending (`payplus_unconfirmed`) for the office to check in PayPlus |
| Refund | `Transactions/RefundByTransactionUID` with the transaction uid and amount, `initial_invoice: true` (PayPlus's credit document) |
| Cancel a standing order | nothing to call: a token is charged only when we ask |

A saved card is kept as the mandate id `payplus:<customer uid>:<token>` (a token charge needs both).

## What the owner needs from PayPlus

1. A PayPlus terminal with a payment page, and the Invoice+ module on that page (so PayPlus issues the receipts).
2. Bit turned on for the page, to offer Bit.
3. The API key and secret key, the payment page uid, the terminal uid and the cashier uid (PayPlus dashboard).

## Not verified yet (try in PayPlus's staging before `RSWIM_PAYPLUS_LIVE=1`)

1. Card: pay ₪1 on `/pay/<token>` → the callback arrives signed, the checkout turns paid, PayPlus issued the receipt.
2. The hash: whether it covers the raw bytes or PayPlus's own re-serialization (both are accepted).
3. Standing order: where the callback reports the saved card's token. The callback schema shows none; we read
   `data.card_information.token` (as the refund answer has it) or `data.token_uid`. Without a token no standing order
   is created, though the payment itself is recorded.
4. A page without Invoice+: whether `initial_invoice: true` is refused.
5. Bit: the Bit tab opens and its callback looks like a card's.
6. Refund and a monthly token charge on the staging terminal.
