# ADR 0001: Use a modular monolith

- Status: accepted
- Date: 2026-08-28

## Context

Practice, question progress, test submission, vocabulary, and user deletion share one transactional PostgreSQL data model. The project is maintained by one small team and deploys to one Vercel application.

## Decision

Keep one deployment and one database while enforcing domain boundaries inside the repository. Modules own their routes, application services, domain logic, and data access. Shared platform code is limited to HTTP, authentication, database, observability, and external-client infrastructure.

## Consequences

- Cross-domain transactions remain simple and reliable.
- Local development and deployment stay inexpensive.
- Module ownership must be enforced through imports and review rather than network boundaries.
- A module can be extracted later when measured load, availability, data residency, or team ownership requires it.
