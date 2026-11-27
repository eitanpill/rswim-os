# Cardcom

The first real payment adapter (`packages/integrations/src/cardcom.ts`), written from Cardcom's API v11
(`https://secure.cardcom.solutions/swagger/v11/swagger.json`, read 2026-11-27) and tested against recorded answers in
`packages/integrations/test/cardcom.test.ts`. No test talks to Cardcom.

## Two uses, two switches

| Use | Who enters the credentials | Where | Switch |
| --- | --- | --- | --- |
| A business's own processor (families and divers pay the school) | The owner | `/admin/integrations/payments` or `/dive/payments` → Cardcom: terminal number, API name, API password (sealed with the school's data key) | `RSWIM_CARDCOM_LIVE=1` on web and worker. Without it the connection is saved as "not live yet" and nothing is charged |
| The platform's own terminal (schools pay Aqua Swim) | Pit | Vercel (web) and Railway (worker) environment: `PLATFORM_CARDCOM_TERMINAL_NUMBER`, `PLATFORM_CARDCOM_API_NAME`, `PLATFORM_CARDCOM_API_PASSWORD` | Setting them opens the sign-up card step (`/billing/card`) and the monthly charges. Unset = the card step stays closed, as today |

In a sandboxed process (`RSWIM_PAYMENTS_SANDBOX`, `RSWIM_GROW_FAKE`, `RSWIM_DEMO_MODE`) the demo processor still wins,
so local runs, CI, staging and the live demo never call Cardcom.

## How each flow maps onto Cardcom

| Ours | Cardcom |
| --- | --- |
| Connection check (on save) | `LowProfile/Create` for ₪1 that nobody is sent to; `ResponseCode 0` = the terminal and API name work |
| Card checkout | `LowProfile/Create`, `Operation: ChargeOnly`, redirect to `Url` |
| Bit checkout | the same page, redirect to `UrlToBit` (a terminal without Bit returns none: the owner gets an error, nothing opens) |
| Standing-order checkout | `ChargeAndCreateToken` when there is an amount now, `CreateTokenOnly` (J2 check, ₪1, not charged) when not |
| Owner's subscription card | `CreateTokenOnly` on the platform terminal |
| Callback | Cardcom posts to `WebHookUrl` (`/api/webhooks/pay/<connectionId>`, `/api/webhooks/platform-card`). The body is **not trusted**: we read only `LowProfileId` and ask `LowProfile/GetLpResult` with our own credentials, then require our terminal number and our `ReturnValue` (`<checkout id>|<method>`) |
| Monthly charge of a saved card | `Transactions/Transaction` with `Token`, `CardExpirationMMYY` and `ExternalUniqTranId` (a hash of our idempotency key); a repeat (code 608) is answered with the first charge from `Transactions/GetTransactionByExternalUniqTran` |
| Refund | `Transactions/RefundByTransactionId` with the API password and `PartialSum` |
| Cancel a standing order | nothing to call: a token is charged only when we ask |

A saved card is kept as the mandate id `<token>:<MMYY>` (Cardcom needs the expiry to charge the token).

## Not verified yet (try in Cardcom's test terminal before `RSWIM_CARDCOM_LIVE=1`)

1. Card: pay ₪1 by card on `/pay/<token>` → the checkout turns paid, the ledger has the payment, a refund works.
2. Bit: the Bit button opens Cardcom's Bit page, and the result carries `TranzactionInfo` like a card does.
3. Standing order: save a card with no amount (token only) → the family has a standing order; check whether Cardcom
   reports the card's last four digits on a token-only page (we show `0000` when it does not).
4. A wrong API name on the connection screen gives "failed" with a clear code; a wrong API password is only noticed
   on a refund (no harmless call checks it).
5. Webhook: Cardcom's server reaches `/api/webhooks/pay/<connectionId>`, and whether it posts JSON or a form (both are read).
6. Platform: sign up a test school, save a card on `/billing/card`, run the monthly billing for it.

Cardcom's test terminal and test card are given by Cardcom with the account; nothing of the kind is stored here.
