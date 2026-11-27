# Receipts: Morning or the processor's own documents

Each business picks **one** source for its tax documents on `/admin/integrations/receipts` (`/dive/receipts`):

- **Morning** (`docs/payments/MORNING.md`): the business's own Morning API key.
- **The processor's own documents**: offered only when the connected processor's API issues documents
  (`PAYMENT_GATEWAYS[kind].documents === 'api'`). It uses the processor's sealed credentials; no other key is needed.

The choice is one row in `invoicing_connections` (`provider` = `morning` or `processor`), so choosing one replaces the
other. The worker issues each payment's document through that single source (`invoicingProvider(orgId)` →
`loadInvoicing`), and our checkouts never ask the processor for a document on the payment page. A payment gets
exactly one document from us.

The one way to get two is outside our system: a processor dashboard that issues a document for every charge by itself.
The screen tells the owner to turn that off when the source here is Morning.

## What each processor offers (checked 2026-11-27)

| Processor | Documents through its API | Here |
| --- | --- | --- |
| Cardcom | Yes. `Documents/CreateDocument` (tax invoice-receipt, receipt, refund types), `Documents/CancelDoc`, and a `Document` object on the payment page and token charge | Offered, not live. The swagger we can read stops before the schemas, so the exact request (payment parts, line fields) is taken from Cardcom's interactive docs (`/Api/v11/Docs`) before the adapter is written |
| PayPlus | Yes. `POST /api/v1.0/books/docs/new/{docType}` (`inv_tax_receipt`, `inv_receipt`, `inv_refund`, …) with `transaction_uuid`, `vatType`, `send_document_email`; the business turns on PayPlus's invoice module | Offered. The adapter comes with the PayPlus processor PR |
| SUMIT | Yes. `POST /accounting/documents/create/` and documents on charges | Added to the list with the SUMIT processor PR |
| Grow | Only from Grow's own dashboard; Grow reports each one on `invoiceNotifyUrl` (`invoiceNumber`, `invoiceUrl`). No API call issues one | Not offered. The business uses Morning, or Grow's own setting with Morning off. Recording Grow's callback is a later step |
| Tranzila | Through a separate documents app (Shopify); no public API found | Not offered |

## Switches

- In a sandboxed process (`RSWIM_PAYMENTS_SANDBOX`, `RSWIM_GROW_FAKE`, demo mode) the processor's documents run on the
  fake, so the choice can be shown end to end.
- Otherwise `processorDocumentsLive(kind)` is false for every processor until its document adapter is tested in the
  processor's sandbox. Choosing it is saved as "not live yet" and nothing is issued, exactly like an adapter that
  isn't live.
- Disconnecting the processor stops its documents as well. The documents wait, and none is issued elsewhere.
