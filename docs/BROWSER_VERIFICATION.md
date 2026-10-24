# TC-037 — desktop and mobile browser verification

Automated verification: 2026-10-23 (America/Toronto), Windows host.
Physical iPhone acceptance: **pending**; the owner will test later.
Browser emulation and Playwright WebKit are not an actual iPhone Safari test.

## Repeatable local production-build checks

Run `npm run build`, then
`npx playwright test --config playwright.browser-matrix.config.ts`.
Install the required Playwright Chromium, Firefox and WebKit engines first.
The existing localhost harness disables real databases, email, SMS and other
live providers; form submission uses a mocked durable-success response.
The harness also pins Gmail OAuth callbacks to localhost, disables inherited
live receptionist configuration and blanks Twilio credentials. Synthetic
workspace sessions use independent documentation-range client identities so
parallel-suite login limits do not collide; production rate limits are unchanged.

Thirty cases passed: ten in each browser engine. Each engine covers English
and French at 1440×1000, 360×780, 390×844 and 844×390, plus two touch-driven
receptionist demo checks. The standard CI browser suite includes the ten
Chromium cases; the three-engine config is an additional local command.

Coverage includes mobile menu open/Escape close, internal header destinations,
horizontal overflow, real bundled video decoding/play/pause/seek, captions file
availability, transcript and demo CTA, trade-selection arrow-key focus, labeled
contact fields, WCAG A/AA automated checks, consent/review and mocked submission
confirmation. Both languages and landscape layout are exercised. Screenshots
are emitted to ignored `test-results/` for video and contact layouts.

The tests found and fixed a booking-form keyboard bug: the deferred focus
callback read React's event target after the handler had returned. It now
captures the radio group during the handler and reliably focuses the selected
option after rendering.

WebKit's HTTP localhost harness removes only `upgrade-insecure-requests` from
intercepted document response headers because WebKit otherwise requests local
assets over unavailable HTTPS. No production security header is changed.
Tests wait for the form's existing client draft effect before filling SSR
inputs. These test-only accommodations are not live-site acceptance evidence.

## Read-only public-site checks

`npx playwright test --config playwright.public.config.ts` targets only
`https://tradecatch.ca`. It does not start the local server. Eight checks cover
both languages at the four sizes above, header links, menu keyboard controls,
video play/pause/seek, caption files, no horizontal overflow, and entering the
first form screen without advancing or submitting. API writes are blocked by
the browser test. No lead or notification is created.

These checks inspect the currently deployed site, not proof that un-deployed
changes are live. Repeat after the reviewed revision is deployed. They do not
prove every link/site route, screen-reader behavior, live speech recognition,
hardware keyboard behavior, cellular playback or third-party provider delivery.

### Unresolved production finding

The live run is **not green**: seeking the deployed demo to five seconds returns
to zero, unlike the passing local-build tests. Playback starts successfully.
Read-only header probes for the English platform MP4 requested `bytes=0-1023`
and `bytes=1000000-1001023`; both returned HTTP 200 with the full 5,238,206-byte
length, no `Content-Range` and no `Accept-Ranges`, rather than partial content.
Bodies were cancelled, not downloaded to create replacement media.

This is evidence of a deployed range-serving problem, not proof of its exact
configuration cause. Review the deployed static-asset/cache path and reproduce
with the release artifact before changing infrastructure; preserve streaming and
cache/security headers and test valid, invalid, suffix and unsatisfiable ranges.
Do not buffer entire videos in a Worker to manufacture partial responses.
The initial run also had intermittent non-success automated header-link requests;
separate follow-up reads of `/` and `/fr/reserver-audit` returned 200. Investigate
edge/runtime logs before concluding that these are persistent broken links.
No live configuration, cache purge or deployment was performed for this finding.
The final eight-case public run failed: seven encountered the seek failure;
one stopped at Cloudflare Error 1102, "Worker exceeded resource limits"
(2026-10-24 01:05:12 UTC, Ray ID `a4f51267bbbf4294`). Some audit-form pages also
failed the client-readiness check, so form interaction was not verified for every
live case. Investigate this Ray ID in runtime logs before retrying live probes.

## Deferred iPhone Safari checklist

Record iPhone model, iOS version, date, network and URL; repeat in EN and FR.

1. Open the menu, follow a link, reopen and close it. Confirm nothing clips.
2. Open the video, play/pause/seek, enable captions and open its transcript.
   Try sound after a user gesture. Rotate portrait/landscape with the modal open.
3. Use the interactive receptionist demo's touch controls. Do not assume the
   browser's simulated call proves a real phone call or microphone integration.
4. Fill the audit form without submitting: names, company, trade, contact, city,
   service consent and review. Check email/phone keyboards, visible focus and
   errors, back navigation, scrolling above the keyboard and autofill.
5. Zoom text, try VoiceOver labels/navigation, and check reduced-motion settings.
   Repeat video playback over Wi-Fi and cellular if available.
6. Report overflow, hidden controls, unexpected navigation, freezing, lost input,
   audio/video failures or inaccessible controls, with a screenshot if possible.

TC-037 is not fully closed until the deferred physical-device results are
recorded and any failures are addressed. No database migration or production
data change is part of this work. Rollback the keyboard fix by reverting its
commit and redeploying; test additions and this record do not affect runtime.
