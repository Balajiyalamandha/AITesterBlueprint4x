# VMO-001: Login button unresponsive on Safari

**Status:** Open
**Priority:** High
**Component:** Frontend / Auth
**Reported By:** QA Team
**Date:** 2026-10-24

## Description
When attempting to log into the QABuddyAI dashboard using Safari (version 17.0), clicking the "Sign In" button does not trigger any network request. The button appears to be active but fails to fire the `onClick` event.

## Steps to Reproduce
1. Navigate to `https://localhost:3000/login`.
2. Enter valid credentials.
3. Click the "Sign In" button.

## Expected Behavior
The user should be redirected to the `/dashboard` route, and a JWT token should be stored in local storage.

## Actual Behavior
Nothing happens. The console shows no errors, but the form submission is blocked.

## Environment
- OS: macOS Sonoma 14.0
- Browser: Safari 17.0
- Branch: `main`

## Proposed Fix
Check the event listener binding in `LoginForm.jsx`. It may be using a deprecated event handling syntax that Safari handles differently than Chrome.