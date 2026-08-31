# Production runbook

## Release gate

1. Use separate Clerk and Neon environments for local, preview, and production.
2. Run `npm ci`, `npm run verify`, and an online `npm audit --omit=dev --audit-level=high`.
3. Set `TEST_DATABASE_URL` to an isolated Neon branch and run `npm run test:integration`.
4. Create a Neon restore point or branch before a production migration.
5. With the owner credential available only to the release environment, run `npm run db:migrate`, `npm run db:grant-runtime`, and `npm run db:seed:reference`.
6. Deploy the immutable commit. Never run migrations from the Vercel function.
7. Verify `/api/health`, Google sign-in, module creation, answer persistence, submission, review, vocabulary review, account separation, and account deletion.
8. Verify Clerk browser traffic uses `/__clerk/*`, the proxy never returns or logs the Clerk secret, redirect locations remain on the application origin, and Vercel CDN caching is disabled for proxy responses.
9. Publish accurate privacy/terms pages with operator contact information and review whether the intended College Board content use is licensed or otherwise permitted. This is a legal launch requirement, not something application code can establish.

## Edge protection

Vercel provides platform DDoS protection, but application traffic still needs project rules. In Vercel Firewall:

1. Start a rule for `/api/*` in log mode and observe normal traffic for at least ten minutes.
2. Add a rate-limit rule for API traffic. Begin conservatively around 600 requests per five minutes per IP, then tune from real autosave traffic.
3. Apply a much lower rule to `/api/import`, `/api/import-new`, and `/api/cache-all`; these routes are also server-authorized for administrators.
4. Exclude or separately limit `/api/webhooks/clerk`; Clerk signatures and the receipt ledger protect authenticity and retries.
5. Add a separate rule for `/__clerk/*`. Start in log mode, then rate-limit obvious abuse without blocking ordinary sign-in bursts. Clerk also applies its own IP-aware protection through the trusted Vercel forwarding header.
6. Enable Vercel spend notifications and a hard budget appropriate for the project.

Vercel documents project WAF rules and rate limiting at https://vercel.com/docs/vercel-firewall. In-memory limits are intentionally not used because serverless instances do not share state.

## Monitoring

- Alert on elevated 5xx rate, p95 API latency, function timeouts, Clerk webhook failures, and Neon connection/storage limits.
- Retain structured Vercel logs outside the short interactive window if the selected plan requires longer incident history.
- Use request IDs from responses to correlate client reports with server logs.
- Review Clerk and Neon audit/security events after account or credential changes.
- Keep Vercel, Clerk, Neon, and GitHub owner accounts protected by MFA or passkeys.

## Backup and recovery

- Confirm Neon's retention window for the selected plan; do not assume a restore point exists.
- Perform a restore drill into a new branch before launch and at regular intervals.
- Verify question catalog, test history, tenant isolation, and vocabulary progress after a restore.
- Recovery point and recovery time targets must be chosen before real users rely on the service.

## Secrets

- Vercel receives `DATABASE_URL`, the public Clerk configuration, the production Clerk secret, the webhook signing secret, authorized origins, and optional administrator IDs. The Clerk secret is scoped to Production and is consumed only by the server-side request authenticator and `api/clerk.js` proxy.
- `DATABASE_ADMIN_URL` belongs only in the protected release environment.
- Rotate a credential immediately if it appears in Git, browser code, logs, screenshots, or support messages.
- Use Clerk production keys only for production; previews use a development instance and isolated database branch.

## Rollback

Migrations are additive and deployed before compatible code. To roll back, redeploy the previous application commit. Do not reverse a migration during an incident. Destructive cleanup, if ever needed, belongs in a later reviewed migration after the compatibility window.
