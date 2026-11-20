# KAN-23: password visibility toggle

Every password field in the customer sign-in, password-choice and change-password
screens has a show/hide eye button inside its right edge. Nothing about
authentication changed: no route, validation rule, hashing, JWT or session code was
touched.

## Where it applies

| Screen | File | Fields |
| --- | --- | --- |
| Sign in (`/login`, `/fr/connexion`) | `src/components/app/LoginForm.tsx` | Password |
| Choose or reset a password (`/set-password`) | `src/components/app/SetPasswordForm.tsx` | New password, Confirm password |
| Change password (`/app/settings/security`) | `src/components/app/PasswordSettings.tsx` | Current, New, Confirm new |

The administrator screens have **no password inputs** to cover: administrators never
see or set a customer password (a password is chosen by the owner from an emailed
link), and administrator sign-in uses the same `/login` form.

All three forms now use one reusable component, `src/components/PasswordField.tsx`
(label + input + toggle). Labels are in `src/messages/{en,fr}.json` under
`passwordToggle`. No new dependency; the icon is an inline SVG.

## Behaviour

- Hidden by default (`type="password"`). The toggle switches the same input element to
  `type="text"` and back, so the typed value is never touched. When the field had
  focus, the caret/selection is put back and focus stays in the field (the button
  swallows `mousedown`, which also keeps the phone keyboard open).
- State is a `useState(false)` inside each field: independent per field, never stored,
  reset by any reload. It is also reset on `pagehide`, so a page restored from the
  back/forward cache comes back hidden.
- The button is a real `<button type="button">`: Tab/Enter/Space work natively and it
  can never submit the form.
- The visible password is plain text to the browser, so every field sets
  `spellCheck={false}`, `autoCapitalize="none"` and `autoCorrect="off"` (keeps it out of
  spell-check services and phone auto-correct). Edge's own reveal button is hidden
  (`::-ms-reveal`) so there is only one eye.

## Accessibility

- Name: "Show password" / "Hide password" (French: "Afficher le mot de passe" /
  "Masquer le mot de passe"), switching with the state. `aria-pressed` is deliberately
  not used as well; the label already carries the state.
- `aria-controls` points at the input. `aria-describedby` points at the field's label, so
  three same-named buttons on the change-password screen are announced with their field
  ("Show password, New password").
- The toggle sits **outside** the `<label>`, so the input's accessible name stays
  "Password" (existing `getByLabel("Password", { exact: true })` specs keep working).
- Focus: the same orange 2px ring as the inputs (`focus-visible`), drawn inset on the
  button. Icon colour is navy at 70% (about 7:1 on white).
- Target: 44 px wide by the input's full height; text padding stops before the icon.
- Verified with axe (WCAG 2.0/2.1/2.2 A and AA) on `/login` with the password hidden
  **and** shown, plus the existing axe specs for `/login`, `/forgot-password`,
  `/set-password`, `/fr/connexion`.

## Tests

`tests/password-visibility.spec.ts` (13 tests):

| Ticket test | Covered by |
| --- | --- |
| PASS-01 hidden by default | PASS-01 |
| PASS-02 click shows | PASS-02 and PASS-03 |
| PASS-03 click again hides | PASS-02 and PASS-03 |
| PASS-04 value preserved after typing | PASS-04 (also caret, focus, typing continues at the caret) |
| PASS-05 independent fields | PASS-05 on `/set-password` (2 fields) and on `/app/settings/security` (3 fields) |
| PASS-06 keyboard | PASS-06 (Tab, Enter, Space, focus ring, no form submit, no request sent) |
| PASS-07 login unaffected | PASS-07 and PASS-08 (wrong then right password with the password shown) |
| PASS-08 reset form | PASS-07 and PASS-08 (choose a password with both fields shown) |
| PASS-09 mobile | PASS-09 at 390 px and 320 px, touch (`tap`), box inside the field, 44 px target, no sideways scroll |
| PASS-10 refresh resets | PASS-10 (reload, plus a `pagehide` that stands in for a back/forward-cache restore) |

Also asserted: toggling sends no network request, the password only appears in the two
real submissions (`set-password`, `password-login`), nothing lands in `localStorage`,
`sessionStorage` or cookies, and the French labels.

Run: `npx playwright test tests/password-visibility.spec.ts` (needs the usual local e2e
harness; on this machine set `TRADECATCH_E2E_CHROME_PATH` to the system Chrome because
Playwright's own browser revision is not installed).

## Verification record (2026-11-19)

- `npx tsc --noEmit`, `eslint --max-warnings=0` on the touched files, `check:i18n`: clean.
- Playwright: the 13 new tests plus `password-login`, `a11y-smoke`, `auth-session` and
  `account-lifecycle` together: 63 passed.
- `npm run test:unit`: 3162 passed, 3 skipped, 1 failed. The failure
  (`call-activity` "shows the stored UTC time in the business's own zone") is a time-zone
  database issue on this Node and fails identically on the untouched base branch.

## Not verified

- Firefox and Safari (WebKit): their Playwright builds are not installed here, so the
  caret after a toggle was only exercised in Chrome. Chrome 157 keeps the selection
  natively across a `password`/`text` change (checked directly: 3-7 stays 3-7), so the
  explicit restore in `PasswordField` is a safeguard for engines that might not, and
  PASS-04's caret assertion would also pass in Chrome without it. It is not proven
  necessary or sufficient anywhere else.
- A real phone: the mobile checks use Chrome's touch/mobile emulation at 390 and 320 px.
- Screen readers (NVDA, VoiceOver): the names and descriptions were checked through
  Playwright's accessibility tree, not by listening.
