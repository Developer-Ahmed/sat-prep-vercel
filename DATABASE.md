# Database architecture

## Ownership boundaries

- Clerk owns identity and sessions. PostgreSQL stores only Clerk's opaque user ID in `app_users`.
- Questions, source references, pool memberships, cached content, built-in vocabulary sets, and built-in set membership are shared reference data.
- Progress, test sessions, responses, timing, custom words, vocabulary membership, and reviews are tenant-owned by `user_id`.

## Core invariants

- A SAT question has one canonical `questions` row. Source identifiers and pool membership are separate relations.
- A test session owns ordered modules; a module owns ordered question membership; responses and timing reference that membership with composite foreign keys.
- Every tenant relation includes `user_id` in its primary or candidate key. Composite foreign keys prevent attaching a child row to another user's parent.
- Row-level security is a second authorization boundary. The request layer sets `app.user_id` from a verified Clerk token for every database transaction.
- Production refuses roles that own tenant tables, can assume an owner/elevated role, can create objects in the application schema, bypass RLS, or connect before all tenant policies exist.
- Vocabulary review requests are unique per user, making network retries safe.
- Clerk webhook receipts are transactionally deduplicated by event ID and retain no profile payload.
- Vocabulary concepts may be shared across lists, while membership-level display fields preserve each source list's exact wording and examples.

## Change management

- `DATABASE_ADMIN_URL` is used only by migration, reset, and reference-data scripts.
- `DATABASE_URL` uses the restricted `sat_app` role and is the only database credential present in Vercel.
- The runtime role has statement, lock, and idle-transaction timeouts; bulk writes do not use broad `RETURNING *` clauses.
- Migrations are append-only, checksummed, serialized by an advisory lock, and applied in one transaction.
- Shared vocabulary seeding is explicit and idempotent. It never imports user history.
- The preproduction reset is destructive and requires `CONFIRM_RESET_PREPRODUCTION=DELETE_ALL_DATA`.

## Operational checks

1. Run `npm test` on every change.
2. Run `npm run test:integration` against an isolated Neon branch before release.
3. Run `scripts/explain-critical-queries.sql` after representative data is loaded and retain the plans with the release record.
4. Use a Neon branch or restore point before production migrations.
5. Verify two independent Clerk accounts cannot read or mutate each other's rows.
6. Run `npm run db:grant-runtime` after migrations add a table or sequence.
