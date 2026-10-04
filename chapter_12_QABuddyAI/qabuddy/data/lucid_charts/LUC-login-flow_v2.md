# Lucid — Login Flow v2 (extracted diagram)

Source: Lucidchart document `Login Flow v2`, exported via the Lucid API and flattened to
node/edge text so the diagram is retrievable. Node ids are preserved for traceability.

## Nodes

- **A. Start** — User opens `/login`
- **B. Email blur** — Run FR-01 email validator
- **C. Decision: email valid?**
  - No -> **C1. Inline error under email** -> back to **B**
  - Yes -> **D**
- **D. Decision: tenant SSO enabled?** (call `GET /api/v2/auth/tenant`)
  - Yes -> **D1. Show "Continue with SSO"** -> **D2. SAML redirect** -> **Z. Dashboard**
  - No -> **E. Show password field**
- **E. Submit** -> **F. Verify captcha (FR-06, score >= 0.5)**
- **F. Decision: captcha passed?**
  - No -> **F1. Inline error under submit** -> back to **E**
  - Yes -> **G. POST /api/v2/auth/login**
- **G. Decision: API result?**
  - `200` -> **G1. Store session** -> **Z. Dashboard**
  - `401 invalid_credentials` -> **G2. Inline error under password (FR-03)** -> **E**
  - `429 account_locked` -> **G3. Inline lockout message, disable submit 15 min (FR-05)** -> **E**
  - `5xx / network` -> **G4. Banner (fallback only)** -> **E**

## Notes on the diagram

- The red dashed edge `G2 -> banner` is the **known defect path** (VWO-125). It should be
  a solid edge to the inline-error node. The diagram was updated on 2026-09-25 to show the
  correct target in green and the buggy edge in red.
- Lockout (G3) must be visually identical to G2 so account existence is not disclosed (SR-03).
- Captcha (F) is verified server-side; the diagram marks it as a trust boundary.
