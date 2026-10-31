# Production deployment runbook

This project is a Next.js Node.js application backed by PostgreSQL. The checked-in build command runs `prisma generate && next build`; database schema setup and demo seeding are explicit one-time operations.

## 1. Create the production database

1. Create a PostgreSQL project in Neon.
2. Copy the pooled PostgreSQL connection string. Keep it private; do not commit it or paste it into source files.
3. Put the production database URL in a local, ignored `.env` file as `DATABASE_URL`.
4. Apply the schema and re-runnable demo seed:

   ```bash
   npm run db:push
   npm run db:seed
   ```

## 2. Import the app into Vercel

1. Import `ArtNayak/Brightloop` in Vercel and select the repository root as the project root. Vercel should detect Next.js automatically.
2. Set these Production environment variables in Vercel:
   - `DATABASE_URL` - Neon pooled PostgreSQL URL
   - `NEXTAUTH_URL` - the final public HTTPS URL for this deployment
   - `NEXTAUTH_SECRET` - generate a unique value with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
   - `MAIL_FROM`
3. Deploy. The configured build command runs `npm run build`; do not run `db:push` or seed as part of every deployment.
4. If the generated Vercel URL changes, update `NEXTAUTH_URL` to match and redeploy.

## 3. Verify and smoke-test

To validate production settings locally without committing them, pull the Vercel Production variables into the ignored file, then run the readiness command:

```bash
vercel env pull .env.production.local --environment=production
npm run verify:deployment
```

`verify:deployment` checks the required variables, PostgreSQL connection, required schema tables and presence of seeded admin, product, plan and discount records. It does not print secret values or change database data.

After deployment, request `https://<your-domain>/api/health`. A healthy response is `200` with `{"status":"ok","database":"ok"}`. Database failures return a generic `503` response without exposing connection details.

Finally, smoke-test the app with the seeded admin, staff and customer accounts. Confirm catalog changes are admin-only, staff catalog pages are read-only, an invoice can be generated and paid, and the customer portal only shows that customer's records. Use the SMTP sandbox credentials configured for the project during demo testing.

## 4. Ongoing deployments

Merge through pull requests. Vercel builds each merge to the configured production branch. Run the smoke checks after the first production deploy and after changes to environment variables or database configuration.
