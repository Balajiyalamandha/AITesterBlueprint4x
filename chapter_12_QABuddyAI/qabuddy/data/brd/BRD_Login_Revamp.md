# Business Requirements Document — Login Revamp

Status: Approved · Owner: Marcus Lee (Business Ops) · Date: 2026-08-30

## 1. Business Context

Support tickets tagged `login` account for 22% of all tier-1 volume in Q3. The dominant
themes are (a) users who cannot tell *why* a login failed, and (b) enterprise customers
blocked by the absence of SSO. The revamp targets both.

## 2. Business Objectives

- **BO-1** Reduce login-related support tickets by 40% within one quarter of launch.
- **BO-2** Unblock enterprise deals worth an estimated $1.2M ARR by shipping SAML SSO.
- **BO-3** Meet the accessibility commitment made in the Q1 enterprise contract (WCAG 2.2 AA).

## 3. Success Metrics

| Metric | Baseline | Target |
|---|---|---|
| Login-related tickets / 1k sessions | 6.4 | 3.8 |
| Login completion rate | 81% | 90% |
| Enterprise SSO adoption | 0% | 60% of enterprise tenants in 90 days |

## 4. Constraints

- No downtime migration: the legacy form stays live behind a feature flag until the new
  form reaches 99% success parity.
- Budget ceiling of 60 engineering days for the quarter.

## 5. Stakeholders

Product (Priya Nair), Engineering (Sam Okafor), QA (Dana Whitfield), Security (Ravi Menon),
Customer Success (Marcus Lee).
