# Grow (Meshulam)

The second real payment adapter (`packages/integrations/src/grow-gateway.ts`), written from Grow's documentation
(`https://developers.grow.business`, read 2026-11-27) and tested in `packages/integrations/test/grow-gateway.test.ts`
against answers in the documented shapes. No test talks to Grow. The older `grow.ts` (a signed webhook shape for the
fake provider) is unrelated to this adapter.

## Who provides what

| What | Who | Where |
| --- | --- | --- |
| User id (`userId`) and the card page's code (`pageCode`) | The business, from Grow | `/admin/integrations/payments` or `/dive/payments` → Grow (sealed with the school's data key) |
| The Bit page's code (`bitPageCode`, optional) | The business, when Grow opened Bit for it | Same screen. Without it, the business offers card and standing order only |
| The platform's key (`apiKey`) and a signed platform agreement | Pit, from Grow (Grow requires both for a platform that serves many businesses) | `GROW_PLATFORM_API_KEY` on web and worker. A business key on the connection (optional field) wins |
| The switch | Pit, after the sandbox test below | `RSWIM_GROW_LIVE=1` on web and worker (`GROW_SANDBOX=1` sends the calls to `sandbox.meshulam.co.il`) |

In a sandboxed process (`RSWIM_PAYMENTS_SANDBOX`, `RSWIM_GROW_FAKE`, `RSWIM_DEMO_MODE`) the demo processor still wins.

## How each flow maps onto Grow

All calls are `POST https://secure.meshulam.co.il/api/light/server/1.0/<method>` with form fields; Grow answers
`{status: 1, data}` or `{status: 0, err: {id, message}}`.

| Ours | Grow |
| --- | --- |
| Connection check (on save) | `createPaymentProcess` for ₪1 that nobody is sent to; a page back = the details work, error 701 = bad user id |
| Card checkout | `createPaymentProcess` (`chargeType 1`) on the card page; our checkout id and method travel as `cField1` / `cField2` |
| Bit checkout | the same on the Bit page code |
| Standing-order checkout | `saveCardToken 1` with a charge now, or Grow's token-only page (`chargeType 3`, sum 1) when nothing is due |
| Callback | Grow posts to `notifyUrl` (`/api/webhooks/pay/<connectionId>`). The body is **not trusted**: we read only `processId` / `processToken`, ask `getPaymentProcessInfo` with the business's own page code, and take the transaction, the amount and our checkout id from Grow's answer. A paid transaction is then acknowledged with `approveTransaction`, as Grow asks |
| Monthly charge of a saved card | `createTransactionWithToken` with `transactionUniqueIdentifier` (a hash of our idempotency key) |
| Refund | `refundTransaction` with Grow's transaction id and token |
| Cancel a standing order | nothing to call: a token is charged only when we ask |

A saved card is kept as the mandate id `grow1:<cardToken>:<phone>:<base64url name>`, because a token charge needs the
payer's name and phone again. A payment is kept as `<transactionId>:<transactionToken>`, because a refund needs both.

## Not verified yet (try in Grow's sandbox before `RSWIM_GROW_LIVE=1`)

1. Where Grow wants the platform key. Its pages say only that every request must include it; we send `X-API-KEY`
   (the only header Grow names). Ask Grow when the platform agreement is signed.
2. Form encoding: we send multipart `FormData` ("FormData format" in Grow's docs) and read callbacks as a form or JSON.
3. Card: pay ₪1 on `/pay/<token>` → paid, ledger has it, `approveTransaction` answered, refund works.
4. Bit: the Bit page code opens Grow's Bit page and the process info reports `transactionTypeId 6`.
5. Standing order: token-only page (₪1, chargeType 3) → whether ₪1 is actually charged, and that `cardToken`
   appears in `getPaymentProcessInfo` (status 11 = held). Then charge the token once from the monthly run.
6. Where `getPaymentProcessInfo` reports our `cField1` (its `customField` shape is not documented; we fall back to
   the callback's copy, and the amount is checked against our checkout either way).
7. A token charge retried after a network error: Grow refuses a repeated `transactionUniqueIdentifier`, and its docs do
   not say whether it then returns the first charge. Until checked, such a retry is recorded as failed.
8. Grow's production review: it checks the integration logs (200 on callbacks, `approveTransaction` sent) and the
   site's terms and privacy pages before opening production.

Grow's sandbox account and test cards come from Grow; nothing of the kind is stored here.
