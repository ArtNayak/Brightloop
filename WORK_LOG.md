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
