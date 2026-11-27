# Morning (Green Invoice): receipts for payments the office records

**The business's payment processor issues the receipt for every payment it takes** (Grow, Cardcom, SUMIT, PayPlus each
issue their own, set up in the processor). We never issue a second document for those payments: the worker skips any
payment whose `source` is `provider` (`issueReceipts(..., { processorIssues: true })`).

Morning is optional. It covers what no processor sees: cash, transfers and cheques the office records. When the owner
connects the business's own Morning account, each of those payments gets its invoice-receipt there. The adapter is
`packages/integrations/src/morning.ts`, written from Morning's official OpenAPI (read 2026-11-27) and tested against
recorded answers in `packages/integrations/test/morning.test.ts`. No test talks to Morning.

With `RSWIM_INVOICING_FAKE=1` (local, CI, the live demo) no real processor is behind a payment, so the fake issues a
document for every payment, to show the flow.

## Who provides what

| Use | Who enters the details | Where | Switch |
| --- | --- | --- | --- |
| A business's own receipts | The owner | `/admin/integrations/receipts` or `/dive/receipts`: API key id + secret, created in Morning under Settings → Developer tools → API keys (needs a Morning plan with API access, Best or higher). Sealed with the school's data key, shown only as the last four characters | `RSWIM_MORNING_LIVE=1` on web and worker. Without it the key is saved as "not live yet" and no document is issued |
| The platform's own invoices to schools | Pit | Railway (worker): `PLATFORM_MORNING_API_KEY_ID`, `PLATFORM_MORNING_API_KEY_SECRET` | `RSWIM_MORNING_LIVE=1` |

`MORNING_SANDBOX=1` sends every call to Morning's sandbox hosts (`api.sandbox.morning.dev` for the token,
`sandbox.d.greeninvoice.co.il` for documents). `RSWIM_INVOICING_FAKE=1` (local, CI, the live demo) keeps the in-memory
fake for every school, and the web app then accepts any well-formed key.

A business without Morning gets no document for a manual payment from us (the worker logs "receipts not usable").
Nothing is ever issued in someone else's account.

## How each flow maps onto Morning

| Ours | Morning |
| --- | --- |
| Connection check (on save) | `POST /idp/v1/oauth/token` with `client_credentials`. A token = the key works; `invalid_client` = wrong key; `unauthorized_client` = the plan has no API. No document is made |
| Manual payment recorded (cash, transfer, cheque) | `POST /documents` type 320 (invoice-receipt) with one payment row; on error 2403 (an exempt dealer) the same as type 400 (receipt) |
| Institution invoice | type 305 with `dueDate` |
| Institution payment | type 400 linked to the invoice (`linkType: link`) |
| Refund | type 330 credit note linked to the original (`linkType: cancel`) |

Lines are sent as totals with VAT included (`vatType: 1` per line), Hebrew, ILS. Payment rows: card and standing order
= 3, Bit = 10 with `appType` 1, PayBox = 10 with `appType` 3, cash = 1, transfer = 4, cheque = 2. The token (one hour)
is kept per process and renewed once on a 401.

## Not verified yet (try in Morning's sandbox before `RSWIM_MORNING_LIVE=1`)

1. The token endpoint and its answer (`accessToken`, `expiresAt` in seconds) as the spec describes.
2. An invoice-receipt for a licensed dealer, and the automatic receipt for an exempt dealer (error 2403).
3. The document link (`url.he`) opens the PDF for a family.
4. A credit note linked with `cancel` closes the original document.
5. **Duplicates**: Morning has no idempotency key. If a call times out after Morning made the document, the worker's
   retry makes a second one. Check whether error 1010 ("duplicate request") covers this; if not, the office cancels
   the extra document in Morning.
6. Where the client's ID number goes (`taxId`) and that `add: false` keeps one-off clients out of the business's list.

## Later

Showing the processor's own receipt to the family: Cardcom returns `DocumentInfo` (number and link) with the payment
result, and Grow posts `invoiceNumber`/`invoiceUrl` to an `invoiceNotifyUrl`. Recording those on the payment would let the
parent portal link the processor's receipt.

Morning's Partners flow (`/partners/users/connection`) would let an owner connect with one approval email instead of
copying a key. It needs a Green Invoice partner code for the platform.
