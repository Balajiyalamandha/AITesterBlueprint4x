// login_validation.ts — VWO login form validation
// Traces to PRD FR-01 (email), FR-02 (password policy at registration), FR-03 (inline errors).

export type ReasonCode =
  | 'invalid_email'
  | 'password_required'
  | 'invalid_credentials'
  | 'account_locked'
  | 'captcha_failed';

export interface LoginResult {
  ok: boolean;
  reason?: ReasonCode;
  token?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(raw: string): string | null {
  const email = raw.trim();
  if (!email) return 'Email is required';
  if (email.length > 254 || !EMAIL_RE.test(email)) return 'Enter a valid email address';
  return null;
}

// FR-02: the login form must NOT enforce the registration password policy. A legacy
// 8-character password has to be accepted here. Only emptiness is invalid at login.
export function validatePasswordAtLogin(raw: string): string | null {
  if (!raw || raw.length === 0) return 'Password is required';
  if (raw.length > 128) return 'Password is too long';
  return null;
}

// FR-03: where a reason code should be rendered.
export function placementFor(reason: ReasonCode): 'email' | 'password' | 'submit' | 'banner' {
  switch (reason) {
    case 'invalid_email':
      return 'email';
    case 'password_required':
    case 'invalid_credentials':
    case 'account_locked':
      return 'password';
    case 'captcha_failed':
      return 'submit';
    default:
      return 'banner';
  }
}

export async function submitLogin(email: string, password: string, captchaToken: string) {
  const res = await fetch('/api/v2/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password, captcha_token: captchaToken }),
  });

  // BUG (VWO-125): every failure is routed to the banner before the reason code is read,
  // so invalid_credentials never reaches placementFor(). Tests TC-LOGIN-007 fail on build 1421.
  // The fix is to consult placementFor(body.reason) and only fall back to the banner
  // for reasons the map does not know.
  if (!res.ok) {
    const body = await res.json();
    return { ok: false, reason: body.reason as ReasonCode, placement: 'banner' as const };
  }

  const body = await res.json();
  return { ok: true, token: body.token };
}
