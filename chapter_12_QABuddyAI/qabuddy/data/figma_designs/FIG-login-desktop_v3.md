# Figma — Login Desktop v3 (extracted spec)

Source: Figma file `VWO-Login-Desktop`, page `v3`, extracted via the Figma REST API / MCP.
This is the machine-readable extraction, not a screenshot: frame text, component names,
design tokens and layout are pulled directly so they are retrievable as text.

## Frame: `login-form` (1440 x 900)

- Heading: `Sign in to VWO`
- Subheading: `Use your work email to continue`
- Input: `input-email` — label `Email`, placeholder `you@company.com`, type email
- Input: `input-password` — label `Password`, type password, trailing icon `eye-off`
- Checkbox: `remember-me` — label `Remember me for 30 days`, default unchecked
- Button: `btn-primary` — label `Sign in`, full width, height 44
- Link: `forgot-password` — label `Forgot password?`
- Divider: `--or--`

## Component: `inline-error` (variant `field`)

- Token `color.error.text` = `#B91C1C`
- Token `color.error.bg` = `#FDF3F3`
- Icon `alert-circle`, size 16, gap 6 to text
- Placement: directly beneath the field, 6px below the input, left-aligned
- Accessibility note in the spec: `aria-live="assertive"`, `role="alert"`

## Component: `banner` (variant `error`)

- Spec note: **Fallback only.** Reserved for non-field errors (network, unknown reason).
  Must NOT be used for `invalid_credentials` or `account_locked` — see PRD FR-03.

## Design Tokens (v3)

| Token | Value | Use |
|---|---|---|
| `color.error.text` | `#B91C1C` | inline error copy |
| `color.error.bg` | `#FDF3F3` | inline error background |
| `color.border.default` | `#E5E2D8` | input border |
| `color.border.focus` | `#D97757` | focused input border |
| `space.field.gap` | `6px` | error below input |
| `radius.input` | `8px` | inputs and buttons |

## Open design questions

- Should the error icon animate on appearance? (Design says subtle fade; a11y review pending.)
- Is the banner ever visible in the invalid-credentials path? Design: no.
