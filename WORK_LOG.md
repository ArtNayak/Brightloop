# Development record

## Person 3 — push 6/7: customer management

**Read:** project overview and Person 3 T6 requirements, existing password policy, role guards, portal isolation, invoice helpers, and the merged subscription/customer schema.

**Plan:** add ADMIN/STAFF customer list/create/detail pages and APIs; force new accounts to CUSTOMER, normalize email and hash the temporary password, avoid exposing password hashes, show subscription/open-invoice counts, and link customer subscription/invoice records. Add local database checks for validation, hashing, duplicate handling, and role forcing.

**Implemented:** searchable 25-row `/customers` list, add-customer form, customer detail with subscriptions, invoices, and computed outstanding balance; GET/POST `/api/customers` and GET `/api/customers/[id]`; Customers navigation. List/API count subscriptions and confirmed invoices. Writes use the shared `passwordSchema`, hash with bcrypt, and assign CUSTOMER on the server even if a client sends a different role.

**Red/green evidence:** `npm run test:customers` checks weak password rejection, lowercased email, ignored role input, forced CUSTOMER role, valid bcrypt hash, hash omission from the creation result, duplicate email 409, and search filters. The test verifies the new account’s role and password hash directly in the local database and cleans up its fixture.

**Verification:**

- `npm run typecheck` — passed.
- `npm run test:customers` — passed against the local database.
- Negative control — temporarily changed the service to force STAFF; the customer test failed on the role assertion, then passed after restoring CUSTOMER.
- `npm run build` — passed, including all customer pages and API routes.
- `git diff --check` — passed.

**Security/leakage review:** customer API list/detail queries explicitly select non-sensitive fields and never return `passwordHash`, reset token, or password. Every customer page and API requires ADMIN or STAFF; create validates before hashing and forces role server-side. Test fixtures use unique emails and are removed in `finally`.
