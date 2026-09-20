# Threat model

## Protected assets

- User test history, answers, timing, flags, and vocabulary progress
- Shared SAT question content and application availability
- Neon runtime and migration credentials
- Clerk sessions, production Clerk secret, and webhook signing secret

The application deliberately stores only Clerk's opaque user ID. Names, email addresses, OAuth tokens, and Google credentials are not copied into PostgreSQL.

## Trust boundaries and controls

| Threat | Primary controls |
| --- | --- |
| Account/session forgery | Clerk-managed Google OAuth; official JWT verification; issuer, expiry, signature, session status, and authorized-party checks |
| Clerk proxy abuse | Clerk's maintained fixed-host proxy; exact path and origin checks; Vercel-overwritten client IP; live-key validation; hop-by-hop header removal; no CDN caching; no credential logging |
| Cross-tenant access | User ownership predicates, composite foreign keys, restricted runtime role, and PostgreSQL RLS set from the verified Clerk ID |
| CSRF | Clerk cookie policy plus rejection of cross-site and untrusted-origin state-changing requests |
| Stored/reflected XSS | Maintained server HTML sanitizer, escaped user vocabulary, restrictive CSP, no inline application scripts |
| SQL injection | Static SQL and bound parameters; runtime role cannot create schema objects or bypass RLS |
| Webhook forgery/replay | Official Clerk signature/timestamp verification and transactional event-ID deduplication |
| Shared-content tampering | The deployed API has read-only catalog privileges; a checksummed, validated seed runs only with the release credential |
| Credential exposure | No browser secrets, a dedicated proxy function that never loads database credentials, separate owner/runtime URLs, production configuration validation, secret scanning in release verification |
| Resource exhaustion | Bounded bodies/content, database timeouts, function duration/memory limits, Vercel DDoS protection, and required WAF rate limits |
| Supply-chain change | Exact production dependency versions, committed lockfile, pinned Clerk browser bundles, Dependabot, CI tests, and online audit gate |

## Residual risks

- A compromised Clerk, Neon, Vercel, GitHub, or operator account remains a supply-chain/control-plane risk; MFA, least privilege, audit review, and credential rotation are operational requirements.
- Question correctness depends on editorial review of the independently authored bank. Automated validation catches structural errors and duplicates but cannot prove academic correctness or score equivalence.
- WAF rules, alerts, backup retention, privacy terms, and restore drills are external configuration and must be verified before public launch.
- Any future third-party content requires written permission and a separate licensing review before it enters the catalog.
