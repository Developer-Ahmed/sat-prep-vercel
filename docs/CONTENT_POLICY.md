# Question content policy

## Allowed content

Every question distributed by PEAK1600 must be either:

1. independently authored for PEAK1600, with provenance recorded in the bank source; or
2. covered by written permission that explicitly allows reproduction in this product.

Public availability, technical API access, or attribution alone does not grant permission to reproduce third-party questions.

## Release requirements

Before a bank version is seeded:

- Verify the prompt, choices, key, and explanation were independently authored or licensed.
- Check mathematical and grammatical correctness manually.
- Confirm exactly one intended multiple-choice answer, or all accepted free-response forms.
- Confirm the domain, skill, and difficulty are reasonable internal labels.
- Run `npm run verify` to reject malformed IDs, duplicate problems, missing explanations, invalid keys, and forbidden upstream attribution.
- Seed only with `DATABASE_ADMIN_URL`; the hosted runtime must retain read-only catalog privileges.

Difficulty labels are editorial estimates. They are not official calibration and do not establish score equivalence or predict a test score.

## Removal

If ownership or correctness is disputed, deactivate or remove the affected original question in a reviewed bank release. Never silently replace a question while retaining its ID; corrections that change meaning or the answer receive a new ID so prior progress remains interpretable.
