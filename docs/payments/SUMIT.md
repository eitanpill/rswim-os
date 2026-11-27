# SUMIT

A business's own processor (`packages/integrations/src/sumit.ts`), written from SUMIT's API as public integrations
quote its published schema (SUMIT's own pages, `https://app.sumit.co.il/developers/api/` and its swagger, could not be
read from the build environment on 2026-11-27) and tested against recorded answers in
`packages/integrations/test/sumit.test.ts`. No test talks to SUMIT. SUMIT issues the receipt for each payment it takes
(`docs/PAYMENTS.md`, Receipts), so we never issue one for those.

## Connecting

| Who | Where | What | Switch |
| --- | --- | --- | --- |
| The owner | `/admin/integrations/payments` or `/dive/payments` → SUMIT | Company number (CompanyID) and API key, both from SUMIT's settings → API. The key is sealed with the school's data key and shown only by its last 4 characters | `RSWIM_SUMIT_LIVE=1` on web and worker. Without it the connection is saved as "not live yet" and nothing is charged |

In a sandboxed process (`RSWIM_PAYMENTS_SANDBOX`, `RSWIM_GROW_FAKE`, `RSWIM_DEMO_MODE`) the demo processor still wins,
so local runs, CI, staging and the live demo never call SUMIT. The platform does not use SUMIT for its own billing.

## How each flow maps onto SUMIT

Every call is a JSON `POST` to `https://api.sumit.co.il/<path>/` with `Credentials: { CompanyID, APIKey }` in the body;
the answer is `{ Status, UserErrorMessage, TechnicalErrorDetails, Data }` (`Status: "Success"` when the call worked).

| Ours | SUMIT |
| --- | --- |
| Connection check (on save) | `billing/payments/beginredirect` for ₪1 that nobody is sent to; a refused key reads "the processor did not accept the keys" |
| Card checkout | `billing/payments/beginredirect` (VAT included, one payment, `PreventSavingPaymentMethod: true`), redirect to `Data.RedirectURL` |
| Standing-order checkout | the same page with `PreventSavingPaymentMethod: false`: the first month is charged and the card stays on the customer at SUMIT. A standing order with nothing to charge now is refused (SUMIT's page charges) |
| Bit | not offered: SUMIT's documentation does not say the hosted page takes Bit |
| Callback | SUMIT posts to `IPNURL` (`/api/webhooks/pay/<connectionId>`). The body is **not trusted** and not signed: we read only the payment id (JSON, a dotted form or a `json=` form) and ask `billing/payments/get` with our own key, then require our `ExternalIdentifier` (`<checkout id>\|<method>`). Approved = `ValidPayment` and a zero `Status` |
| Monthly charge of a saved card | `billing/payments/charge` with `Customer: { ID, SearchMode: 1 }` (the customer's saved card at SUMIT). SUMIT documents no idempotency key, so a charge whose answer was lost is **not** sent again: the payment stays pending (`sumit_unconfirmed`) for the office to check in SUMIT |
| Refund | none over the API: the office refunds in SUMIT, which also issues the credit document. Refunding from our screen shows an error |
| Cancel a standing order | nothing to call: the saved card is charged only when we ask |

A saved card is kept as the mandate id `sumit-customer:<SUMIT customer id>`.

## What the owner needs from SUMIT

1. A SUMIT account with card clearing (סליקה) turned on.
2. The company number and an API key (SUMIT → settings → API). Nothing else: no public key, since card details are
   entered only on SUMIT's own page.

## Not verified yet (try in a SUMIT test company before `RSWIM_SUMIT_LIVE=1`)

1. The paths: public integrations disagree on `https://api.sumit.co.il/billing/...` and `.../api/billing/...`; the
   adapter uses the first (seen against the live API in `Digitizers/sumit-api`).
2. Card: pay ₪1 on `/pay/<token>` → the IPN arrives, the checkout turns paid, SUMIT issued the receipt.
3. The IPN body: which field carries the payment id (we read `PaymentID`, `Payment.ID`, `OG-PaymentID`, also under
   `Data` or a `json=` form). If SUMIT sends none of them, the IPN is ignored and the payment never settles.
4. Standing order: the payment reports `CustomerID` and the card's last digits (`PaymentMethod.CreditCard_LastDigits`;
   we show `0000` otherwise), and a later `billing/payments/charge` with that customer charges the saved card.
5. A wrong API key's `UserErrorMessage` (we read "api key", "credential", "הרשא" or "מפתח" as a refused key).
6. Whether the hosted page can offer Bit, and whether SUMIT offers a refund call or a charge idempotency key.
