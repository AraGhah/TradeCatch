# Handoff: TradeCatch marketing site redesign

## Overview
A full visual and UX redesign of the TradeCatch marketing site (Next.js 16 App Router,
next-intl en/fr, Tailwind v4). Covers eight routes — Home, Services, How It Works,
Industries, Pricing, About, FAQ, and a rebuilt Book-Audit form — plus a shared header,
mobile nav, and footer.

The redesign keeps all existing content and functionality from `src/messages/en.json`
and rewrites the copy to be sharper and less generic. The audit form was converted from
a long single-page form into a **one-question-per-screen wizard**.

## About the Design Files
`TradeCatch.dc.html` is a **design reference built in HTML** — a working prototype that
shows the intended look, motion, and behaviour. It is **not production code to copy**.
The task is to recreate it inside the existing Next.js app, using its established
patterns: server components where possible, `next-intl` translations for every string,
Tailwind v4 theme tokens in `src/app/globals.css`, the existing `Container`,
`SectionHeading`, `CTAButton` primitives (updated to the new tokens), and framer-motion
for the reveal/stagger behaviour already present in `src/components/motion/`.

Every string in the prototype must go back into `src/messages/en.json` **and** be
translated in `fr.json` before shipping — the prototype hardcodes English.

## Fidelity
**High fidelity.** Final colours, typography, spacing, motion, and interaction states.
Recreate pixel-perfectly using the codebase's existing libraries.

---

## Design Tokens

Replace the current palette in `src/app/globals.css`. Old → new:

| Role | Old | New | Notes |
| - | - | - | - |
| Ink (primary dark) | `--color-navy #122033` | `#0C141E` | page-level dark sections, primary buttons |
| Ink surface | `--color-navy-light #1c3252` | `#16222F` | button hover on ink |
| Ink panel | — | `#0F1926` | inset panels on ink (stat strip, dashboard) |
| Paper (page bg) | `--color-bg #f7f6f3` | `#F4F1EC` | warmer |
| Paper deep | — | `#EAE5DC` | image placeholder wells |
| White | `#ffffff` | `#FFFFFF` | alternating sections, cards |
| Ember (accent) | `--color-orange #f28c28` | `#E4762B` | **large text ≥18.66px bold, fills, dots only** |
| Ember hover | `--color-orange-dark #d9740f` | `#F08B45` | primary button hover (lighter, not darker) |
| Ember text | — | `#A94F12` | **required** for ember text under 18.66px — passes 4.5:1 on paper and white |
| Signal green | `--color-green #248a5a` | `#2F9E68` | dots, fills, text on ink |
| Signal green text | — | `#1E6B47` | small green text on white |
| Body text | `--color-text #1d2430` | `#1A2430` | |
| Muted text | `text/70` | `#5C6875` | body copy + all mono labels. Do not go lighter — this is the AA floor |
| Secondary text | — | `#3D4855` | list items inside cards |
| Blue | `--color-blue #2457c5` | **removed** | the palette is ink + paper + ember + green only |

Hairlines: `rgba(12,20,30,0.08)` (section dividers), `rgba(12,20,30,0.10)` (grid cell
borders, card borders), `rgba(12,20,30,0.12)` (list rules), `rgba(12,20,30,0.14–0.18)`
(input and secondary-button borders).
On ink: `rgba(255,255,255,0.08–0.12)`. Mono labels on ink: `rgba(255,255,255,0.64)`
(0.42 fails AA — do not reduce).

**Contrast rule that must survive implementation:** the site's own accessibility
statement (`legal.accessibilityStatement`) commits to WCAG 2.1 AA. Any text ≤18.66px
needs 4.5:1. That is why there are separate "fill" and "text" variants of ember and
green above.

### Typography
Replace Manrope + Inter.

| Role | Family | Weights |
| - | - | - |
| Display / headings | **Archivo** | 700, 800 |
| Body | **IBM Plex Sans** | 400, 500, 600, 700 |
| Labels, numerals, timestamps, data | **IBM Plex Mono** | 400, 500, 600 |

Scale (all fluid — no breakpoint jumps):
- Hero h1 — `clamp(40px,5.6vw,74px)` / line-height `0.98` / tracking `-0.042em` / 800
- Page-hero h1 — `clamp(36px,4.8vw,62px)` / `1.02` / `-0.042em` / 800
- Section h2 — `clamp(32px,4vw,52px)` / `1.03` / `-0.04em` / 800
- Sub-section h2 — `clamp(28px,3.6vw,46px)` / `1.05` / `-0.04em` / 800
- Card h3 — `19.5–24px` / `-0.028em` / 700
- Lede — `clamp(16.5px,1.35vw,19px)` / `1.62`
- Body — `15–16.5px` / `1.6–1.65`
- Mono label — `11px` / tracking `0.16em` / uppercase (section kickers); `10.5–12px` /
  `0.10–0.14em` elsewhere

### Spacing & shape
- Container: `max-width 1280px`, padding `clamp(20px,4vw,40px)`. Narrow variants:
  1040px (How It Works), 900px (FAQ), 760px (wizard).
- Section padding: `clamp(80px,9vw,140px)` vertical; page heroes
  `clamp(56px,7vw,96px)` top.
- Radii: 8–10px (nav items, small buttons), 11–13px (buttons), 14–16px (chips, small
  cards), 18–20px (panels, cards), 999px (pills), 46px outer / 36px inner (phone frame).
- Shadows: card hover `0 26px 46px -28px rgba(12,20,30,.34)`; ink panel
  `0 40px 70px -44px rgba(12,20,30,.7)`; ember CTA
  `0 14px 34px -16px rgba(228,118,43,.8)`; phone `0 60px 90px -50px rgba(0,0,0,.9)`.

### Responsive strategy
No media queries. Every multi-column layout is
`display:grid; grid-template-columns:repeat(auto-fit,minmax(Xpx,1fr))` and collapses on
its own. The **only** JS breakpoint is the header: `window.innerWidth >= 1080` switches
between the desktop nav and the hamburger. Reproduce this — do not add Tailwind
breakpoints for the content grids.

---

## Screens / Views

### Shared — Header
Sticky, `z-index 60`, `background rgba(244,241,236,0.82)` + `backdrop-filter blur(14px)`.
Height `clamp(68px,7vw,86px)`.
On `scrollY > 10`: background → `rgba(244,241,236,0.92)`, bottom border →
`rgba(12,20,30,0.10)`, shadow → `0 8px 30px -18px rgba(12,20,30,.35)`. Transition 0.3s.
- Logo: 34px ink rounded-square (radius 10) containing a 14×7 CSS checkmark (rotated
  span with `border-left`/`border-bottom` 2.2px ember), then "TradeCatch" in Archivo 800
  19px, tracking `-0.035em`. There is no logo asset in `public/` — only Next.js
  defaults — so this mark stands in for the source's `CheckIcon`-in-a-square. Swap it
  for a real logo when one exists.
- Nav links: 14.5px/500, `#5C6875`, hover `#0C141E`. Active route shows a 2px ember
  underline inset 14px from each side, 2px above the baseline.
- Right cluster: phone `438·993·6997` in IBM Plex Mono 13px; EN/FR pill (2px padding,
  999px radius, active segment = ink fill + white text); primary "Book the audit"
  button — ink fill, white text, 12px/20px padding, radius 10, with a 6px ember dot
  after the label. Hover: `#16222F` + `translateY(-1px)`.
- Below 1080px: compact "Book audit" button + a 42px hamburger (two 17×1.8px ink bars).

### Shared — Mobile menu
Full-screen ink overlay, `z-index 80`, `animation tcIn .3s`. Six nav items as Archivo
700 26px white rows separated by `rgba(255,255,255,0.09)` rules. Pinned to the bottom:
phone number and a full-width ember "Book the free audit" button.

### Shared — Footer
Ink background. Four-column `auto-fit minmax(220px,1fr)` grid; the brand block spans 2.
Contains the inverted logo, a description, service area in mono, phone + email, a
Company link list, a Legal link list, then a bottom bar with the copyright and the
liability disclaimer (both required — carry them over verbatim from
`footer.disclaimer`).

---

### 1. Home
Sections in order:

1. **Hero** — ink, `padding clamp(56px,7vw,96px) 0 clamp(72px,8vw,120px)`.
   Two-column `auto-fit minmax(400px,1fr)`.
   - Background: 64px grid of `rgba(255,255,255,0.045)` 1px lines, masked with
     `radial-gradient(120% 80% at 30% 0%, #000, transparent 72%)`; parallax
     `translateY(scrollY * 0.12)`. Plus a 520px ember radial glow at top-right.
   - Left: status pill ("Pilot program · Québec trades") with a pulsing green dot
     (`tcPulse` 2.4s); h1 "Every missed call is a job someone else is **booking**."
     (ember on the last word); lede; ember primary CTA + ghost "Watch the flow";
     a mono reassurance line; a 3-item trust row above a hairline.
   - Right: **phone frame** — 46px-radius bezel with a
     `linear-gradient(160deg,#2A3846,#141F2B 55%,#0A1017)` fill, 11px padding, 36px inner
     radius, screen height `min(660px,72vh)`. Parallax `translateY(scrollY * -0.045)`.
     Screen: white status bar (notch pill, mono time/LTE, business avatar "NP", green
     "AUTO-REPLY ACTIVE"), the message thread, and a mono footer disclaimer.
     A floating white "Appointment booked" card sits at `left:-8px; bottom:54px` with
     `tcDrift` 7s.
   - **Live SMS demo** — see Interactions.
2. **Stat strip** — ink, four cells in a 1px-gap grid on `rgba(255,255,255,0.1)`, cells
   `#0F1926`. Values `<30s / 4 / 2 / 0` in Archivo 800 34px (first is ember). These are
   product facts, deliberately not performance claims — the business has no clients yet.
3. **Leaks** — paper. Sticky left column (`top:120px`) with kicker, h2, lede and a
   white secondary CTA; right column is three rules-separated rows numbered 01–03 in
   ember mono, each with an Archivo 700 heading and body. Row hover:
   `background rgba(255,255,255,0.6)`.
4. **System** — white. Header row (kicker + h2, and a right-aligned ghost link with a
   1.5px underline). Below: six cells, `auto-fit minmax(268px,1fr)`, 1px gaps on a
   `rgba(12,20,30,0.1)` grid, 18px outer radius, `overflow:hidden`. Each: ember mono
   number, a 26px hairline dash, h3, body. Hover `background #FAF8F5`.
5. **Before / after** — paper. Two panels, `auto-fit minmax(320px,1fr)`.
   Left: translucent white, red dot, "Handling it manually", 5 muted rows.
   Right: ink, green dot, ember "With TradeCatch installed", 5 white rows, big shadow.
6. **Dashboard** — ink. Left copy column + a `#0F1926` panel: header row ("Week of
   14 Apr" / pulsing "Sample data"), an `auto-fit minmax(148px,1fr)` metric grid on 1px
   gaps, and a mono "Illustrative data" footer. Metric values **count up** on scroll.
7. **Industries** — paper. Header row + 3 white cards (`auto-fit minmax(280px,1fr)`,
   hover `translateY(-5px)` + shadow), then a "Also built for" row of 7 pills.
8. **Founder** — white. Left: 4:5 portrait (`public/images/founder.jpg`) with an ink
   name-card overhanging at `right:-14px; bottom:-18px`. Right: kicker, h2, a pull-quote
   with a 2px ember left border, four bullets, ink CTA + email link.
9. **Pilot** — paper. Left: ember "Limited intake" chip, h2, body. Right: white card
   listing what pilot companies get, plus the launch guarantee under a rule.
10. **FAQ teaser** — white. Sticky-ish left column + 4-item accordion.
11. **Final CTA** — ink, centred, masked grid background, `max-width 960px`. h2 at
    `clamp(34px,4.8vw,64px)`, lede, large ember CTA, 4 checked expectations.

### 2. Services
Ink page hero, then five stacked white cards (`auto-fit minmax(280px,1fr)` internally:
number + title + purpose on the left, a two-column checked item list on the right).
Then an ink "Bolt-ons, once the core is earning" card with 7 outlined pills. Centred
ember CTA.

### 3. How It Works
Ink page hero. `max-width 1040px`. Six stages, each a rule-separated row: a 44px ink
square with an ember mono number + Archivo title on the left, a wrapping row of white
pills on the right (hover lifts 2px). Then a white card containing the Day 2 / 5 / 10 /
20 quote sequence as a four-cell 1px-gap grid, plus the stop-on-reply note. Ink CTA.

### 4. Industries
Ink page hero. Five rule-separated sections, each: `NN · Trade` in ember mono, an
Archivo headline, and a "Where it earns its keep" checked list in two columns.

### 5. Pricing
Ink page hero with extra bottom padding (`clamp(80px,9vw,130px)`); the tier cards
**overlap it** via `margin-top: clamp(-60px,-5vw,-40px)`. Three white cards
(`auto-fit minmax(290px,1fr)`), hover `translateY(-6px)`. Growth carries a "Most
popular" ember chip. Price in Archivo 800 `clamp(26px,2.6vw,32px)`, cadence beneath in
mono. Full-width outline button per card that inverts to ink on hover. Below: a
two-column "Why there's a range" / "No surprises" panel.
Figures come from `pricing.tiers` — **confirm they are current before shipping**.

### 6. About
Ink page hero. Two columns: 4:5 founder portrait with a mono caption; right side an
Archivo h2, intro, and a six-row numbered list (ember mono `01–06`) built from
`about.body`. Ink CTA + email link.

### 7. FAQ
Ink page hero. `max-width 900px`. Ten-item accordion (same pattern as the teaser), then
a centred ink "Still have a question?" card with an ember CTA.

### 8. Book Audit — one-question-per-screen wizard
**This replaced the old single-page form.** `main` is
`min-height: calc(100vh - 86px)`, flex column.

- **Progress bar** — sticky at `top: clamp(68px,7vw,86px)`, `z-index 30`, translucent
  paper + blur. Row: "Question N of 18" (left) and "~M min left" (right), both mono
  11px uppercase `#5C6875`. Below: a 3px track `rgba(12,20,30,0.1)` with an ember fill
  that transitions `width .45s cubic-bezier(.22,1,.36,1)`.
  Time estimate: `max(1, round((total - step) * 9 / 60))` minutes.
- **Question area** — centred, `max-width 760px`, `animation tcIn .42s` on every step
  change. Ember mono step number + a 22px hairline, then the question as an Archivo 800
  `clamp(28px,4vw,46px)` h1, then optional help text.
- **Input kinds**
  - `name` — two fields (First / Last) in an `auto-fit minmax(220px,1fr)` grid, each a
    borderless Archivo 700 `clamp(22px,2.4vw,28px)` input over a 2px bottom rule that
    turns ember on focus.
  - `text` — one such input at `clamp(24px,3vw,34px)`. `inputType` may be
    `text | email | tel`.
  - `textarea` — white, 1.5px border, 14px radius, 4 rows, ember border on focus.
  - `choice` — `auto-fit minmax(232px,1fr)` grid of full-width rows. Unselected: white,
    1.5px `rgba(12,20,30,0.14)` border, 13px radius, with a mono index key on the right;
    hover `translateY(-2px)` + ink border + shadow. Selected: ink fill, white text,
    ember check.
  - `consent` — two bordered checkbox cards (required contact consent; optional
    marketing consent, never pre-checked — CASL).
- **Footer controls** — ember "Continue" when valid; a greyed, non-interactive pill with
  the same label when not (disabled state stays visible, never hidden); "Back" from
  step 2 on; "Skip" for optional questions; "or press Enter ↵" hint on text steps.
- **Review step** (index 18) — every answer as a two-column row with an ember "Edit"
  link that jumps straight back to that question. Button label becomes "Submit request".
- **Confirmation** — centred, pulsing green check disc, Archivo h1 "Got it. Your audit
  request is in.", body, "Back to the site" + "Submit another".
- **Reassurance bar** — pinned under the wizard: "No commitment · You get the findings
  either way · Or call 438·993·6997".

#### The 18 questions (id · kind · label · title)
1. `name` · name · Name · "First — who are we talking to?"
2. `company` · text · Company · "What's the company called?"
3. `trade` · choice · Trade — Plumbing, HVAC, Electrical, Roofing, Renovation, Landscaping, Paving, Excavation, Fencing, Other
4. `city` · text · City · "Where do you operate from?"
5. `language` · choice · Language — English, Français
6. `email` · text(email) · Email
7. `phone` · text(tel) · Phone
8. `employees` · choice · Team size — Just me, 2–5, 6–15, 16–30, 30+
9. `calls` · choice · Calls / month — Under 50, 50–150, 150–400, 400+, Honestly no idea
10. `missed` · choice · Missed / week — 0–5, 5–15, 15–30, 30+, No idea
11. `afterHours` · choice · After hours — Yes always, Sometimes, No
12. `quotes` · choice · Quotes / month — Under 10, 10–30, 30–75, 75+
13. `jobValue` · choice · Average job — Under \$1,000, \$1,000–\$5,000, \$5,000–\$15,000, \$15,000+
14. `crm` · text · Current tools · **optional**
15. `handlesCalls` · choice · Handles calls — Me the owner, Office staff, An answering service, Nobody consistently
16. `followsQuotes` · choice · Chases quotes — Me the owner, Office staff, The technician, Nobody consistently
17. `problem` · textarea · Biggest problem · **optional**
18. `consent` · consent · Consent

These map onto the existing `bookAudit.fields` keys and the Zod schema in
`src/lib/validation/book-audit.ts`. Keep the existing POST to `/api/book-audit`,
Turnstile verification, rate limiting, and idempotency untouched — only the presentation
changed. The choice options are new and need adding to `en.json` / `fr.json`.

---

## Interactions & Behavior

### Live SMS demo (hero)
A looping six-beat script rendered into the phone thread:
1. event — "MISSED CALL · (514) 555-0182" · 7:42 · 900ms after
2. outbound — "Sorry we missed your call — this is Nord Plomberie. What's the issue, and what's the address?" · 1300ms typing · 900ms after
3. inbound — "No heat, furnace won't start. 12 Oak St." · 1500ms typing · 800ms after
4. outbound — "Got it. Can you send a photo of the unit? Alerting our on-call tech now." · 1200ms typing · 1000ms after
5. event — "ON-CALL TECH ALERTED · MARC D." · 7:44 · 1100ms after
6. win — "APPOINTMENT BOOKED · 8:15 AM" · 7:51 · 1000ms after

Then a 3800ms hold, reset to empty, and replay. Before each text bubble a typing
indicator shows on the correct side (three dots, `tcBlink` 1.2s with 0.2s stagger).
Each message enters with `tcIn .38s`.

Bubble styles — outbound: white, 1px `rgba(12,20,30,0.08)` border, radius
`18px 18px 18px 5px`, left-aligned. Inbound: ink fill, white text, radius
`18px 18px 5px 18px`, right-aligned. Event: full-width `rgba(12,20,30,0.05)` chip with a
grey dot, mono text, mono timestamp. Win: same but `rgba(47,158,104,0.1)` fill, green
border, `#1E6B47` text.

**Critical:** the thread container is `flex` column with **`justify-content: flex-end`**
and `overflow: hidden`. Messages stack up from the bottom so the final "APPOINTMENT
BOOKED" beat is always visible and older messages fall off the top. Do **not** try to
solve this by scripting `scrollTop` — on an `overflow:hidden` box the assignment is not
honoured, and at short viewports the container is only ~250px tall.

### Scroll reveals
Elements marked `data-reveal` start at `opacity 0; translateY(18px)` and animate to
`opacity 1; none` over `0.7s cubic-bezier(.22,1,.36,1)`, with a `(index % 5) * 60ms`
stagger. Driven by an IntersectionObserver at `rootMargin: "0px 0px -12% 0px"`,
`threshold 0.05`, unobserving after firing.

**Do not add a blanket timeout that force-reveals everything** — an earlier version had
a 4s safety net and it silently killed every scroll animation on the page. If you want
a no-JS fallback, gate it on `!("IntersectionObserver" in window)`.

### Count-up
`data-count` elements read their own `textContent` as the target, then animate 0 → value
over 900ms with `1 - (1-p)³` easing, restoring the exact original string at the end
(this preserves formats like `14 800 $`). Skipped when the parsed number is 0 or
> 100000. Fires once at `threshold 0.4`.

### Parallax
Hero grid `translateY(scrollY * 0.12)`; phone `translateY(scrollY * -0.045)`. Both
clamped to `scrollY < 1200`. Disabled at motion level "subtle" and "off".

### Accordions
Single-open. Clicking the open item closes it. Sign toggles `+` / `−` in ember mono.
The answer panel mounts with `tcIn .3s`.

### Routing
Client-side page state. On page change: reset scroll with
`window.scrollTo({top:0,left:0,behavior:"instant"})` — **`behavior:"instant"` is
required** because `html { scroll-behavior: smooth }` swallows a plain `scrollTo(0,0)`
during the DOM swap. Then re-run the reveal/counter observer wiring for the new route.
In the real app this is Next's router, so most of this is handled for you — but keep
the reveal re-wiring on route change.

### Reduced motion
`@media (prefers-reduced-motion: reduce)` forces all animation and transition durations
to `0.001ms` and disables smooth scroll. The demo's typing delays collapse to 200ms.

### Keyframes
```css
@keyframes tcIn    { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:none } }
@keyframes tcBlink { 0%,80% { opacity:.22 } 40% { opacity:1 } }
@keyframes tcPulse { 0% { box-shadow:0 0 0 0 rgba(47,158,104,.45) } 70% { box-shadow:0 0 0 9px rgba(47,158,104,0) } 100% { box-shadow:0 0 0 0 rgba(47,158,104,0) } }
@keyframes tcDrift { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-9px) } }
```

---

## State Management
- `page` — active route (replace with the Next router).
- `shown`, `typing` — SMS demo cursor and which side is typing. Timer ids are collected
  and cleared on unmount.
- `faq` — index of the open accordion item, `-1` for none.
- `menu` — mobile nav open.
- `wide` — `window.innerWidth >= 1080`, from a passive resize listener.
- `step`, `answers`, `consent`, `marketing`, `formDone` — wizard state. Validation:
  a step is satisfied if it is optional, or (name) first name is non-empty, or (consent)
  the required box is ticked, or the answer string is non-empty.

No data fetching in the prototype. In the real app the wizard's final submit posts to
the existing `/api/book-audit` route.

## Assets
- `assets/founder.jpg` — copied from `public/images/founder.jpg` in the repo. Used at
  4:5 on Home and About.
- No icon library. The few glyphs used are HTML entities (`&#10003;` check,
  `&#8594;` arrow, `&#8629;` return, `&#215;` close) and CSS shapes. The repo's
  `src/components/icons.tsx` set is no longer used on these screens — decide whether to
  keep it for other routes.
- There is **no brand logo asset** in `public/` (only the Next.js default SVGs). The
  header mark is CSS. Commission or supply a real mark.

## Files
- `TradeCatch.dc.html` — the complete prototype: all eight routes, header, mobile nav,
  footer, the SMS demo, and the wizard.
- `image-slot.js` — the drag-and-drop image placeholder used for the founder photo.
  Prototype-only; do not port it.
- `assets/founder.jpg` — founder portrait.
