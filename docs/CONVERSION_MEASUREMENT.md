# Conversion changes — TC-036

The English/French homepage leads with missed callers recovered and more booked
jobs, without guaranteed results. The demo retains its honest fictional/pilot
disclosure and gains a direct free-audit next step. Playback start, completion
and audit clicks are measured only with analytics consent.

The intake now has six question screens plus review, down from seven plus
review: email and phone share a labeled, mobile-stacking contact screen. Required
fields, consent, Turnstile, server validation and durable-success checks remain.
Deep qualification remains on the call rather than in this short request.

## Measurement

With the existing GA configuration and analytics consent, record:

- `audit_form_started`: first form interaction, not a mere page view.
- `audit_step_viewed`: reached step, using `form_version=short_contact_v2`.
- `audit_form_abandoned`: one candidate exit at the current step per departure,
  from visibility-hidden, pagehide or client navigation; elapsed seconds only.
- `audit_form_resumed`: a later interaction after a candidate exit.
- `audit_form_completed`: only after the server confirms durable lead storage.
- Existing `audit_step_completed`, `audit_form_submitted` and `generate_lead`
  remain available. Demo events use `demo_video_started`,
  `demo_video_completed`, and `demo_video_audit_click`.

No field answers, email, phone, name, customer ID, query string or free text is
included in the new events. Rejecting or withdrawing analytics consent prevents
their transmission. No new tracking service or cookie is introduced.

Compare GA sessions that start vs complete by form version and locale, and use
the last step and resume events to investigate drop-off. Hidden tabs, phone app
switching, browser crashes and blocked analytics mean exits are estimates, not
proof of abandonment. Some exit events may never reach GA; do not equate counts
with all visitors or claim a conversion lift before collecting comparable data.
Analytics consent and service-contact consent remain independent.

No migration or new environment variable is needed. Roll back the TC-036 commit
and redeploy to restore the earlier copy, form screens and measurement behavior.
