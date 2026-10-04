# Login Sprint — Weekly Notes

Date: 2026-09-18 · Attendees: Priya Nair, Sam Okafor, Dana Whitfield, Ravi Menon

## Decisions

- **D1** Inline error rendering (FR-03) ships in this sprint. The banner is demoted to a
  fallback only for non-field errors (e.g. network failure).
- **D2** Lockout stays at 5 attempts / 15 minutes (FR-05). Security prefers 3; Product
  argues 3 causes legitimate-user lockouts. Compromise: 5, revisit after launch.
- **D3** reCAPTCHA score threshold fixed at 0.5 (SR-04). Lowering it is a config change,
  not a code change, so it can be tuned without a release.

## Open Items

- Sam to confirm the `sso_required` redirect preserves the originally requested deep link.
- Dana to add TC-LOGIN-006..008 covering the inline error path before the build is cut.
- Ravi to verify constant-time behaviour on the lockout path (SR-03).

## Blockers

- None for the sprint. The legacy password policy mismatch (FR-02) is confirmed
  intentional: login must not enforce registration rules.

## Action Items

| Owner | Action | Due |
|---|---|---|
| Sam | Wire `reason` code to inline copy map | 09-22 |
| Dana | Regression pass on build 1421 | 09-24 |
| Ravi | Threat-model the SSO redirect | 09-25 |
