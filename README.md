# Brightloop

Subscription management: Next.js 16 (App Router) + TypeScript + Prisma + PostgreSQL + Tailwind.

## Setup

```bash
cp .env.example .env        # set NEXTAUTH_SECRET to any random string
docker compose up -d        # local Postgres (or point DATABASE_URL at a Neon DB)
npm install
npm run db:push && npm run db:seed
npm run dev                 # http://localhost:3000
```

Seeded logins (password `Passw0rd!`): `admin@`, `staff@`, `customer@brightloop.test`.

After every `git pull`: `npm install && npm run db:push`. If the data looks off: `npm run db:reset`.

## Ownership (stay in your folders)

| # | Feature | Folders |
|---|---|---|
| 1 | Password reset, staff creation (admin), payments, overdue tracking, finance dashboard, customer portal | `src/app/(auth)`, `src/app/api/auth`, `src/lib/auth.ts`, `src/app/(app)/{payments,reports,portal}` |
| 2 | Products, variants, taxes, plans, discount rules (admin CRUD) | `src/app/(app)/{products,plans,discounts}` |
| 3 | Quotation templates, subscriptions, state machine | `src/app/(app)/subscriptions` |
| 4 | Invoices, billing run, tax calc, discount application, confirm/cancel/send/print | `src/app/(app)/invoices`, `src/lib/billing` |

Put API routes next to your feature: `src/app/api/<feature>/...`. Guard them with `requireRole()` from `@/lib/rbac`.

## Shared files (small PRs, tell the team)

- `prisma/schema.prisma`: tiny PR, merge immediately, everyone runs `npm run db:push`. We use `db push`, not migrations.
- `package.json`: announce new dependencies.
- `src/lib/nav-items.ts`: only edit your own line.
- UI kit: shadcn/ui on Tailwind 4. Add components with `npx shadcn@latest add <name>` (e.g. `table`, `dialog`, `select`); they land in `src/components/ui`. Commit them in your own PR.
- Next 16: route guard lives in `src/proxy.ts` (was `middleware.ts`).

## Git rules

- No direct pushes to `main`. Branch `feat/<name>-<thing>`, open a PR (draft is fine), one quick approval, **rebase and merge**.
- **Push at least once every hour**: `git add -A && git commit -m "feat(scope): msg" && git fetch && git rebase origin/main && git push -u origin HEAD`
- Commit small, often, as `feat|fix|chore(scope): message`.
- Your `git config user.email` must match your GitHub account email, or commits won't count for you.
