# Billing engine (P4)

What turns subscriptions into invoices, and what staff can do with those invoices.

```
subscription (ACTIVE, due) --billing run--> invoice DRAFT --confirm--> CONFIRMED --payment--> PAID
                                                  |                        |
                                                  +--------- cancel -------+  (only while there are no payments)
```

## Files

| File | Job |
| --- | --- |
| `calc.ts` | Pure money math: per-line discounts, tax, totals. No database. |
| `terms.ts` | Payment terms (`IMMEDIATE`, `NET_15`, `NET_30`, `NET_45`) and the due date. |
| `run.ts` | The billing run (`runBilling`), the preview filter (`billableWhere`), gapless invoice numbers. |
| `deps.ts` | The only place that imports other people's code: period maths (P2), discount status (P2), lifecycle (P3). |
| `invoices.ts` | Confirm, cancel, bulk confirm, list, detail, send. |
| `invoice-email.ts` | The HTML email (every dynamic value escaped). |
| `invoice-ui.ts` | Display helpers shared by the pages: money, dates, which buttons a status gets, list URLs. |
| `http.ts` | Turns errors into JSON `{ error }` responses. |

## Rules

- **Money** is `Prisma.Decimal`, two decimals, half-up. API responses carry money as strings. Never use floats.
- **An invoice's lines are a snapshot** of the subscription lines (name, price, tax rate) at billing time. Later price changes don't touch old invoices.
- **Discounts** each apply to the original eligible amount (they don't compound), capped per line. A limited discount is reserved with a guarded update inside the invoice's transaction, so two runs can't both take the last use, and a failed invoice gives the use back.
- **Due date** is a calendar day: UTC midnight of issue day + terms (`IMMEDIATE` = same day).
- **Overdue** is never stored. It is `CONFIRMED` and due before today (UTC), the same rule everywhere (`finance.ts`).
- **PAID is only ever set by the payment transaction** (P1). Nothing here marks an invoice paid.

## The billing run

`runBilling()` first runs P3's lifecycle (activate subscriptions that start today, close expired auto-close ones), then bills every `ACTIVE`, unpaused subscription whose `nextBillingDate` has passed.

- **Idempotent.** `unique(subscriptionId, periodStart)` plus a compare-and-set on `nextBillingDate` make double billing impossible, even with two runs at once. Running twice creates nothing new.
- **Catch-up.** Missed periods are billed one invoice each, oldest first, up to 24 per subscription per run. The next run continues.
- **Period maths always starts from the original start date**, so a monthly subscription that started on the 31st goes Jan 31, Feb 28/29, Mar 31 (it never drifts to the 28th).
- **One transaction per subscription.** A failure rolls that subscription back completely (invoice, billing date, discount usage) and the rest carry on. Failures are listed in the summary with a safe message; details stay in the server log.
- **Invoice numbers** are `INV-0001`, `INV-0002`, ... with no gaps. A rolled-back invoice gives its number back; a number taken by someone else is retried.
- **Skipped on purpose:** no lines, only free lines, or past the expiry date (`periodStart >= expiryDate`, so no period that starts on the expiry day is billed). These stay "due by date" but are reported as skipped, and the preview (`billableWhere`) doesn't count them. The preview is an estimate: the run starts with the lifecycle, which can activate a subscription (billed, though not counted) or close one (counted, not billed), so the dialog says "About N" and never blocks the run.

## Invoice actions (all ADMIN or STAFF only)

| Action | Allowed when | Notes |
| --- | --- | --- |
| Confirm | `DRAFT` | A guarded update: two clicks can't both win. |
| Confirm all drafts | any number of `DRAFT` | One UPDATE. Optional list of ids. |
| Cancel | `DRAFT`, `CONFIRMED` with **no payments** | Takes the same row lock as a payment, so a payment and a cancel can't both succeed. A cancelled invoice keeps its period locked, so it is never billed again. |
| Send | `CONFIRMED`, `PAID` | Emails the customer a link to `/portal/invoices/[id]`. Mail errors become a generic 502. |

## Checks

| Command | Needs | Covers |
| --- | --- | --- |
| `npm run check:billing` | nothing | calc, terms, email, display helpers |
| `npm run check:invoice-view` | nothing | the invoice, list table and print sheet render correctly and safely |
| `npm run check:route-guards` | nothing | every billing/invoice route calls `requireRole(ADMIN, STAFF)` first |
| `npm run check:billing-run` | local DB (schema pushed) | the run: catch-up, month end, expiry, discounts, rollback, concurrency, number collisions |
| `npm run check:invoices` | local DB | confirm/cancel guards and races, list filters, detail, send |
| `npm run check:billing-seed` | local DB holding **only the team seed** | the run against everyone's real seed, with independent arithmetic; restores what it touched |
| `npm run check:invoice-http` | app running at `BASE_URL` + seeded DB | roles over HTTP, the three invoice pages, no secrets in any response |

The DB checks refuse to run against a non-local database (override with `ALLOW_REMOTE_TEST_DB=1`).
