# ADR 0002: Keep Neon PostgreSQL as the system of record

- Status: accepted
- Date: 2026-08-28

## Context

The product requires tenant isolation, relational integrity, transactions, analytics, idempotency, and durable user history. The existing schema expresses those requirements with native constraints, composite foreign keys, indexes, and row-level security.

## Decision

Continue using pooled Neon PostgreSQL with separate migration-owner and restricted runtime roles. Preserve direct SQL for query-intensive paths until TypeScript contract coverage makes evaluation of a typed SQL layer low risk.

## Consequences

- PostgreSQL remains the final authority for ownership and invariants.
- The application can scale independently through serverless compute while preserving transactional semantics.
- Query plans, migrations, connection behavior, backups, and RLS policies remain explicit operational responsibilities.
