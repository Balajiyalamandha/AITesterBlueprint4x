# QA Process Handbook

Owner: Dana Whitfield (QA Lead) · Revision 7 · Applies to: all VWO web releases

## 1. Defect Severity

| Severity | Definition | Example |
|---|---|---|
| S0 — Blocker | No workaround; core flow unusable; data loss or security exposure | Login completely unavailable |
| S1 — Critical | Major function broken, workaround painful | Wrong password shows no feedback at all |
| S2 — Major | Function impaired but usable | Error shown in the wrong place (banner vs inline) |
| S3 — Minor | Cosmetic or low impact | Misaligned icon in the error state |
| S4 — Trivial | Nice to have | Copy could read better |

## 2. Priority vs Severity

Priority is a scheduling decision, not a severity restatement. An S2 that blocks an
enterprise contract can be P1. The QA lead sets priority in triage; the reporter sets
severity.

## 3. Evidence Standards

Every defect MUST carry:
- the exact build number being tested,
- a screenshot or video of the failing state,
- the steps to reproduce, numbered,
- the expected result with a citation to the requirement (PRD/FRD/SRS id).

A ticket without a requirement citation is returned to the reporter. This is how we keep
severity honest: S2 is not a matter of taste, it is a requirement that was not met.

## 4. Defect Triage Cadence

- New defects reviewed daily at 10:00.
- S0/S1 paged immediately to the on-call engineer.
- Duplicates are linked, not closed, so the reporter can see the trail.

## 5. Exit Criteria

A release ships when: zero S0/S1 open, all P1 fixed, regression suite green on the target
build, and every closed defect has evidence attached.

## 6. Accessibility Testing

WCAG 2.2 AA is contractually required for enterprise tenants (BO-3). Screen-reader
announcements for validation errors are checked manually for the login module before every
release.
