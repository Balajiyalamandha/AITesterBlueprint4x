# Product Requirements Document — VWO Login Dashboard v2

Status: Approved · Owner: Priya Nair (Product) · Last updated: 2026-09-15

## 1. Purpose

The VWO Login Dashboard is the authentication surface for the VWO experimentation
platform. This release replaces the legacy single-page form with a validated, accessible
login experience that supports email/password plus enterprise SSO.

## 2. Functional Requirements

### FR-01 — Email field validation
The email field MUST be validated on blur and on submit using a single shared validator.
Valid formats: `user@domain.tld`. Leading/trailing whitespace MUST be trimmed before
validation. The field MUST reject an empty value with the message "Email is required".

### FR-02 — Password policy
Passwords MUST be at least 12 characters and contain at least one number and one symbol.
The policy is enforced at registration; the login form MUST NOT enforce it (a legacy
password would otherwise be rejected at login). Maximum accepted length is 128 characters.

### FR-03 — Inline error messaging
Validation and authentication failures MUST surface an inline, field-level error message
rendered directly beneath the offending field. The error MUST also announce to screen
readers via `aria-live="assertive"`. A generic top-of-form banner alone does NOT satisfy
this requirement — reported as VWO-125.

### FR-04 — Single sign-on
Enterprise tenants MUST be able to authenticate via SAML 2.0. When an email domain maps
to an SSO-enabled tenant, the password field is replaced by a "Continue with SSO" action.

### FR-05 — Rate limiting and lockout
After 5 consecutive failed attempts for the same email the account MUST be locked for 15
minutes. The lockout response MUST be identical in shape to an invalid-credentials
response so that account existence is not disclosed.

### FR-06 — Bot protection
The login form MUST present a reCAPTCHA v3 challenge. A failed challenge MUST be treated
as an authentication failure and MUST NOT reveal whether credentials were valid.

## 3. Non-Functional Requirements

| Id | Requirement | Target |
|---|---|---|
| NFR-01 | Login API p95 latency | < 400 ms |
| NFR-02 | Availability | 99.95% monthly |
| NFR-03 | Password storage | Argon2id, never logged |
| NFR-04 | Accessibility | WCAG 2.2 AA, full keyboard operation |
| NFR-05 | Audit logging | Every attempt logged with tenant, outcome, and reason code |

## 4. Out of Scope

- Passwordless / magic-link login (planned for v3)
- Social login (Google, GitHub)
- Self-service account deletion

## 5. Release Criteria

All FR-01..FR-06 pass regression, NFR-01 verified under 500 concurrent users, and the
WCAG audit has no open AA violations.
