# Production setup: Clerk, Neon, and Vercel

This is the hosted application. The original `sat-prep-app` directory remains an independent SQLite application for local use.

## Architecture

- Clerk authenticates users and manages Google OAuth, sessions, account recovery, and the account UI.
- Neon PostgreSQL stores the shared SAT catalog and each user's private progress.
- Vercel serves the static app, runs the authenticated API function, and exposes a separate narrow Clerk proxy function at `/__clerk/*` when using a `vercel.app` production domain.
- The browser never receives a database credential, Clerk secret, or another user's identifier.

The Clerk publishable key is intentionally public. `DATABASE_URL` and every future secret must remain server-side environment variables.

## 1. Create the Clerk application

1. Create a Clerk application and enable Google under **SSO connections**.
2. Use separate Clerk Development and Production instances.
3. Copy the instance's publishable and secret keys. The backend uses Clerk's maintained request authenticator to retrieve and cache the instance's rotating JWKS verification keys.
4. The secret key is also required by the server-side `/__clerk` proxy on `vercel.app` deployments. It must never appear in browser code, Git, screenshots, or logs.
5. Add these application routes in Clerk:

```text
Sign-in URL: /sign-in
Sign-up URL: /sign-up
Home URL: /
```

6. For a `vercel.app` production domain, enable Clerk's provider-domain proxy and set its URL to:

```text
https://your-project.vercel.app/__clerk
```

7. In **Clerk Dashboard > Webhooks**, create an endpoint for:

```text
https://your-project.vercel.app/api/webhooks/clerk
```

Subscribe to `user.created` and `user.deleted`, then copy its `whsec_...` signing secret. The deletion event removes the user's private PostgreSQL records through foreign-key cascades.

For production Google sign-in, finish Clerk's production OAuth setup and add the callback URL Clerk gives you to the Google Cloud OAuth client.

## 2. Create Neon PostgreSQL

1. Create a Neon project in the region closest to the majority of users.
2. Keep the owner connection string as `DATABASE_ADMIN_URL`; it is used only for migrations.
3. In the Neon SQL Editor, create a separate least-privileged runtime login. SQL-created Neon roles do not inherit `neon_superuser` membership:

```sql
CREATE ROLE sat_app
WITH LOGIN PASSWORD '<generated-password>'
NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
```

Then run `npm run db:grant-runtime` as the owner. The grant script verifies that `sat_app` is not elevated before assigning its table permissions; it does not attempt to change protected PostgreSQL role flags.
4. Copy the pooled `sat_app` connection string as `DATABASE_URL`.
5. Confirm both URLs use `sslmode=require`.

Create `.env.local` from `.env.example`, then set at least:

```text
DATABASE_URL=<pooled Neon sat_app role URL>
DATABASE_ADMIN_URL=<pooled Neon owner URL>
CLERK_PUBLISHABLE_KEY=<Clerk publishable key>
CLERK_SECRET_KEY=<Clerk development secret key>
CLERK_WEBHOOK_SIGNING_SECRET=<Clerk webhook signing secret>
CLERK_AUTHORIZED_PARTIES=http://127.0.0.1:5174,http://localhost:5174
```

Install the pinned dependency and apply the versioned schema:

```sh
npm ci
npm run db:migrate
npm run db:grant-runtime
npm run db:seed:reference
npm run catalog:seed
```

Migrations are tracked in `schema_migrations` and protected by a PostgreSQL advisory lock, so two migration commands cannot change the schema concurrently.
The catalog seed is a release command that validates and writes the independently authored bank using the owner credential. The web runtime has read-only access to shared question tables.
Migration checksums reject edited or missing migration files. The reference-data seed is idempotent and loads only the built-in vocabulary lists; it does not import user history or the former SQLite database.

## 3. Verify a local account

Start the app and sign in with Google:

```sh
npm run dev
```

## 4. Configure Vercel

Connect this directory's GitHub repository to Vercel with:

- Framework preset: `Other`
- Build command: leave empty
- Output directory: `public`
- Install command: `npm ci`
- Node.js: 22 (local imports require Node 22.5 or newer)

Add the ordinary runtime variables to Production. Preview deployments should use the Clerk development instance and must not receive the production secret or proxy URL:

```text
DATABASE_URL=<pooled Neon sat_app role URL>
CLERK_PUBLISHABLE_KEY=<production Clerk publishable key>
CLERK_SECRET_KEY=<production Clerk secret key, Production only>
CLERK_PROXY_URL=https://your-project.vercel.app/__clerk
CLERK_WEBHOOK_SIGNING_SECRET=<production Clerk webhook signing secret>
CLERK_AUTHORIZED_PARTIES=https://your-project.vercel.app
```

Do not add `DATABASE_ADMIN_URL` to the Vercel application. Keep it only in a protected migration environment such as local administration or CI.

Use the live `CLERK_SECRET_KEY` and `CLERK_PROXY_URL` only in Vercel Production. Preview and Development may use a separate Clerk development secret and must not receive the live secret. Vercel preview origins are added automatically from `VERCEL_URL`; previews use development keys and direct Clerk requests. Keep the production `vercel.app` origin explicitly listed in `CLERK_AUTHORIZED_PARTIES`.

Run `npm run db:migrate` and then `npm run db:grant-runtime` with the protected production `DATABASE_ADMIN_URL` before deploying code that depends on a new migration. The Vercel runtime must continue to receive only `DATABASE_URL`.

Production startup intentionally fails if it sees a Clerk test key, a non-TLS or non-pooled database URL, an HTTP authorized party, or `DATABASE_ADMIN_URL` in the application environment. A production `vercel.app` origin also fails closed unless the exact `/__clerk` URL and matching live Clerk secret are present.

## 5. Production checks

1. Open a private browser window and confirm the app shows Clerk sign-in rather than SAT data.
2. In browser developer tools, confirm Clerk scripts and session requests use `/__clerk/*`, and that responses include `Vercel-CDN-Cache-Control: no-store`.
3. Confirm no response, browser bundle, or Vercel log contains `CLERK_SECRET_KEY` or an `sk_live_` value.
4. Complete Google sign-in, refresh the page, sign out, and sign in again in a private window.
5. Create two test accounts and verify that modules, answers, timing, and vocab progress do not cross accounts.
6. Confirm former catalog mutation paths such as `/api/import` return HTTP 404.
7. Sign out, refresh, and confirm protected APIs return HTTP 401.
8. Create a Neon restore point or export after loading the shared question catalog and vocabulary reference data.

Before public traffic, complete every item in `docs/PRODUCTION_RUNBOOK.md`. In particular, configure Vercel Firewall monitoring/rate limits, budget alerts, log retention, and a tested Neon restore procedure. `/api/health` is the minimal liveness endpoint.

Rotate the Neon password immediately if its connection string is ever committed, pasted into frontend code, or exposed in a screenshot.
