# Functional Requirements Document — Authentication

Version 1.4 · Author: Sam Okafor (Engineering) · Traces to PRD v2

## 1. Login Flow (email/password)

1. User lands on `/login`.
2. System focuses the email field on load (skip focus if a field already has an error).
3. On email blur, FR-01 validator runs. Invalid -> inline error, focus stays.
4. On submit, system trims email, runs FR-01, then posts to `POST /api/v2/auth/login`.
5. On `200`, system stores the session token and redirects to `/dashboard`.
6. On `401`, system renders the failure per FR-03 and clears the password field only.
7. On `429`, system renders the lockout message and disables submit for 15 minutes.

## 2. Error Mapping

| API reason code | User-facing message | Placement |
|---|---|---|
| `invalid_email` | "Enter a valid email address" | inline, under email |
| `password_required` | "Password is required" | inline, under password |
| `invalid_credentials` | "Email or password is incorrect" | inline, under password |
| `account_locked` | "Too many attempts. Try again in 15 minutes." | inline, under password |
| `captcha_failed` | "Verification failed. Please try again." | inline, under submit |
| `sso_required` | redirect to tenant IdP | n/a |

## 3. SSO Flow (FR-04)

1. User enters an email on the login form.
2. On blur, system calls `GET /api/v2/auth/tenant?email=...`.
3. If `sso_enabled: true`, the password field is replaced by "Continue with SSO".
4. Clicking it starts the SAML redirect; the password field is never shown again for
   that session.

## 4. Validation Rules (canonical)

- Email: trimmed, case-insensitive, max 254 chars, single `@`, TLD >= 2 chars.
- Password: min length enforced at *registration only* (FR-02); login accepts any non-empty
  value up to 128 chars.

## 5. Traceability

FR-01 -> TC-LOGIN-001..004 · FR-02 -> TC-LOGIN-005 · FR-03 -> TC-LOGIN-006..008
FR-04 -> TC-LOGIN-009 · FR-05 -> TC-LOGIN-010 · FR-06 -> TC-LOGIN-011
