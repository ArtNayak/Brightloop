# Development record

## Person 2 — push 2/7: catalog seed and discount status

**Read:** project overview decisions and Person 2 T2/T3 seed requirements. Kept the existing finance and billing seed calls intact, and retained the latest main branch's subscription seed after the catalog seed it depends on.

**Plan:** replace the first-tax-only seed guard with stable, repeatable catalog fixtures; add a database-free regression check for fixture contents and rerun behavior; complete the discount status helper used by billing.

**Implemented:** three taxes, five taxed products, three variants, four plans across all billing periods, and three discounts. Catalog rows are found by stable names and updated or created. Variant upserts use the schema’s compound key. Discount `timesUsed` is left untouched on rerun. Seed dates are based on UTC calendar days.

**Red/green evidence:** before the helpers were implemented, `npm run check:catalog-seed` failed because the required discount status module did not exist. After implementation, the new check passed, including an in-memory two-run check that verifies no duplicates and preserves discount usage history.

**Verification:**

- `npm run typecheck` — passed.
- `npm run check:catalog-seed` — passed.
- `npm run check:period` — passed.
- `npm run check:billing` — 16/16 passed.
- `npm run build` — passed.
- `npm run check:billing-run` — safely refused because this worktree has no `DATABASE_URL`; Docker is unavailable, so no database-backed test or database mutation was performed.
- `git diff --check` — passed.

**Security/leakage review:** this change adds seed fixtures and a pure discount-status helper, with no new API route, credential handling, or user-controlled output. No schema changes were made.

## Person 2 - push 3/7: tax management

**Read:** Person 2 T4 and project route/security conventions. No schema changes are needed.

**Plan:** add a validated Decimal-backed tax service, ADMIN-only write routes, ADMIN/STAFF read access, a read-only staff page, and a regression suite for validation and delete behavior.

**Implemented:** tax list/create and update/remove APIs; `/products/taxes` page linked from Products; create/edit/activate/deactivate/remove controls for admins; usage counts and an empty/loading state. Used taxes are deactivated. Unused taxes are hard-deleted, with a foreign-key race falling back to deactivation. API error responses are generic and do not expose database messages.

**Red/green evidence:** before the service existed, `npm run check:taxes` failed because `src/lib/catalog/taxes` was missing. After implementation, all nine validation, update, delete, and race-condition checks passed.

**Verification:**

- `npm run typecheck` - passed.
- `npm run check:taxes` - 9/9 passed.
- `npm run check:catalog-seed` - passed.
- `npm run check:period` - passed.
- `npm run check:billing` - 20/20 passed.
- `npm run build` - passed, including `/api/taxes`, `/api/taxes/[id]`, and `/products/taxes`.
- `git diff --check` - passed.

**Security/leakage review:** GET is restricted to ADMIN/STAFF; every mutation requires ADMIN before parsing the request. Staff receives no mutation controls. Unexpected API failures return generic messages. Role behavior was reviewed in the route and page code; database-backed HTTP role tests were not run because no `DATABASE_URL` is configured.

## Person 2 - push 4/7: products and variants

**Read:** project overview decisions D5-D9 and Person 2 T5 requirements. Kept the existing Prisma schema unchanged and used route handlers for mutations.

**Plan:** add decimal-backed product and variant services with red-first regression coverage, ADMIN-only mutation routes and a read-only STAFF product experience, paginated/filterable product browsing, editing and inline variant CRUD. Return P3's active product-picker contract with string decimals and calculate displayed variant totals using the shared `unitPrice()` helper.

**Implemented:** `/products` search by name, type/status filters, 25-row pagination, margin and tax columns, plus `/products/new` and `/products/[id]` detail/edit screens. Added all requested product/variant endpoints. Product removal deactivates products referenced by subscription or quotation lines and deletes unused products; used variants cannot be removed. Unique variant collisions return a friendly 409. Admin-only controls are omitted for STAFF and APIs enforce roles independently. Loading skeletons and empty states are included.

**Red/green evidence:** before implementation, `npm run check:products` failed because `src/lib/catalog/products` did not exist. Final service suite passes 12/12, including tax validation, negative/precision validation, duplicate conflicts, used-line deletion rules, and foreign-key race fallback behavior.

**Verification:**

- `npm run typecheck` - passed.
- `npm run check:products` - 12/12 passed.
- `npm run check:taxes` - 9/9 passed.
- `npm run check:catalog-seed` - passed.
- `npm run check:period` - passed.
- `npm run check:billing` - 20/20 passed.
- `npm run build` - passed; includes all product and variant route handlers and pages.
- `git diff --check` - passed.

**Security/leakage review:** catalog list/details and picker routes require ADMIN or STAFF; every create/update/delete route calls `requireRole("ADMIN")` before parsing or mutating. Staff pages render details in read-only controls. Decimal prices are serialized as strings; unexpected route errors return generic messages. No schema changes. Role guards were reviewed in source; no database-backed HTTP role test was run because a configured test database is unavailable.

## Person 2 - push 5/7: plans

**Read:** project overview decisions D5, D7, D9 and Person 2 T6 requirements. This conflict-resolution branch is based on the current `origin/main`, which now includes push 4 (products and variants).

**Plan:** add regression checks first for plan validation, Decimal storage, behavior flags, availability and period immutability; add a service, ADMIN-only create/update APIs with ADMIN/STAFF read APIs, picker contract, paginated list, editor/detail pages and loading states.

**Implemented:** `/plans` supports name and period filters, 25-row pagination and Upcoming/Available/Ended badges. `/plans/new` and `/plans/[id]` cover all requested fields and explain the four per-plan behavior flags. APIs include `GET/POST /api/plans`, `GET/PATCH /api/plans/[id]` and `GET /api/plans?available=1`; picker responses serialize Decimal prices as strings and only include plans available on today's inclusive UTC calendar day. Server-side validation rejects negative/over-precision/oversized prices, invalid dates and quantities below one. A plan's billing period cannot change after a subscription references it (409).

**Red/green evidence:** before implementing the plan service, `npm run check:plans` failed because `src/lib/catalog/plans` did not exist. After implementation, all six plan service/schema/availability checks passed.

**Verification:**

- `npm run typecheck` - passed.
- `npm run check:plans` - 6/6 passed.
- `npm run check:products` - 12/12 passed on the updated main base.
- `npm run check:taxes` - 9/9 passed.
- `npm run check:catalog-seed` - passed.
- `npm run check:period` - passed.
- `npm run check:billing` - 20/20 passed.
- `npm run build` - passed; includes the merged products work and all plan API routes/pages.
- `git diff --check` - passed.

**Security/leakage review:** plan list and detail GET routes require ADMIN or STAFF; POST and PATCH require ADMIN before parsing request data. New plan page is ADMIN-only; the detail page supplies STAFF read-only controls. Unexpected API errors return generic messages; money values serialize as strings. No schema changes. Database-backed HTTP role tests were not run because no test database is configured.

**Conflict resolution:** preserved current `main`'s product test script and push 4 development record, and added the plan script and plan record alongside them.

## Person 2 - push 6/7: discount rules

**Read:** project overview decisions D3-D9 and Person 2 T7 requirements. Reused the existing discount schema and `discountStatus()` helper without changing billing logic or the Prisma schema.

**Plan:** add red-first checks for type/value, date/scope validation, optional thresholds, target references, Decimal storage, used-rule immutability and all four status values; then add ADMIN-only mutation routes and ADMIN/STAFF read pages.

**Implemented:** `/discounts` lists rules with status, use count/limit, scope target and dates, with name/status filters and pagination. `/discounts/new` and `/discounts/[id]` support fixed or percentage amounts, optional thresholds and usage limits, product targeting, one-subscription targeting or all-subscription scope. Status is computed with the shared helper. Added `GET/POST /api/discounts` and `GET/PATCH/DELETE /api/discounts/[id]`. Used rules cannot change type or scope (409), enforced in the service and locked in the UI. Added the Discounts navigation entry. No discount application logic was changed; billing continues to apply rules.

**Red/green evidence:** before implementation, `npm run check:discounts` failed because `src/lib/catalog/discounts` did not exist. The completed suite passes 7/7, including scheduled/active/expired/exhausted statuses, scope targeting, date/amount validation and the used-rule conflict.

**Verification:**

- `npm run typecheck` - passed.
- `npm run check:discounts` - 7/7 passed.
- `npm run check:plans` - 6/6 passed.
- `npm run check:products` - 12/12 passed.
- `npm run check:taxes` - 9/9 passed.
- `npm run check:catalog-seed` - passed.
- `npm run check:period` - passed.
- `npm run check:billing` - 26/26 passed.
- `npm run build` - passed; includes discount API routes and pages.
- `git diff --check` - passed.

**Security/leakage review:** discount list/detail GET require ADMIN or STAFF; POST/PATCH/DELETE require ADMIN before parsing or mutating. Staff sees read-only screens. Product and subscription targets are validated server-side. Unexpected API errors return generic messages and monetary values serialize as strings. No schema changes. HTTP role tests were not run because this checkout has no `.env` test database configured.
