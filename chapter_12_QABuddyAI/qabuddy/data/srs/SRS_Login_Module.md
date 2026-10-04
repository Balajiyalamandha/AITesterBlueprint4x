# Software Requirements Specification — Login Module

Document SRS-AUTH-002 · Author: Sam Okafor · Reviewers: Ravi Menon (Security), Dana Whitfield (QA)

## 1. Scope

Defines the software-level behaviour of the login module: API contracts, data handling,
logging, and failure semantics. Complements the FRD (functional) with implementation and
security detail.

## 2. API Contract

`POST /api/v2/auth/login`

```json
{
  "email": "user@example.com",
  "password": "string",
  "captcha_token": "string"
}
```

Responses:

| Status | Body |
|---|---|
| 200 | `{"token": "...", "expires_in": 3600, "tenant": "acme"}` |
| 400 | `{"reason": "invalid_email"}` |
| 401 | `{"reason": "invalid_credentials"}` |
| 429 | `{"reason": "account_locked", "retry_after": 900}` |

All 4xx bodies carry a machine-readable `reason` field. The UI maps `reason` to copy; it
MUST NOT build user-facing text from any other field.

## 3. Security Requirements

- SR-01 Passwords hashed with Argon2id (memory 64 MiB, iterations 3, parallelism 1).
- SR-02 Password values MUST NOT appear in any log line, trace, or error payload.
- SR-03 The lockout path (FR-05) MUST return in constant time relative to the
  invalid-credentials path to prevent enumeration.
- SR-04 `captcha_token` is verified server-side against reCAPTCHA v3 with a minimum score
  of 0.5 before any credential check.
- SR-05 Session tokens are opaque, 256-bit, stored in an `HttpOnly; Secure; SameSite=Lax` cookie.

## 4. Logging

Every attempt emits one structured line:

```
level=info event=auth.attempt tenant=acme outcome=failure reason=invalid_credentials
```

`reason` uses the same enumerations as the API table. No email is logged in full; it is
hashed to a stable 8-char digest for correlation.

## 5. Error Rendering

The front end consumes the `reason` code. For `invalid_credentials` and `account_locked`
the message MUST render inline beneath the password field (PRD FR-03), announced via an
assertive live region. The 2026-09 regression showed the banner path rendering instead of
the inline path for `invalid_credentials`; see VWO-125.
