import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderBusinessNotifyEmail } from "../../src/lib/business-notifications";
import { callStatusBanner } from "../../src/product/receptionist/owner-call-alert";
import type { CallSummary } from "../../src/product/receptionist/types";

const summary = (over: Partial<CallSummary> = {}) =>
  ({ outcome: "message_taken", ...over }) as CallSummary;

const banner = (
  s: CallSummary,
  flags: Partial<{ booked: boolean; transferred: boolean; emergency: boolean; needsFollowUp: boolean }>,
  lang: "en" | "fr" = "en",
) =>
  callStatusBanner({
    summary: s,
    booked: false,
    transferred: false,
    emergency: false,
    needsFollowUp: false,
    lang,
    ...flags,
  });

describe("owner call email: what happened, at a glance", () => {
  it("an emergency always wins, even when booked or transferred", () => {
    const b = banner(summary({ outcome: "emergency_transferred" }), {
      emergency: true,
      transferred: true,
      booked: true,
    });
    assert.equal(b.tone, "urgent");
    assert.equal(b.label, "Emergency");
    assert.match(b.detail ?? "", /emergency line/);
  });

  it("distinguishes booked, transferred and follow-up, in both languages", () => {
    const booked = banner(
      summary({ outcome: "appointment_booked", appointment: { status: "booked", label: "Fri Nov 27, 10:00" } as CallSummary["appointment"] }),
      { booked: true },
      "fr",
    );
    assert.deepEqual([booked.tone, booked.label, booked.detail], ["success", "Rendez-vous réservé", "Fri Nov 27, 10:00"]);

    const transferred = banner(summary({ outcome: "transferred", transferredTo: "General line" }), { transferred: true });
    assert.deepEqual([transferred.tone, transferred.label], ["info", "Call transferred"]);

    const follow = banner(summary({ outcome: "appointment_requested" }), { needsFollowUp: true });
    assert.deepEqual([follow.tone, follow.label, follow.detail], ["action", "Follow-up required", "Appointment to confirm"]);

    const faq = banner(summary({ outcome: "faq_answered" }), {});
    assert.equal(faq.label, "No action needed");
  });
});

describe("owner email layout", () => {
  const html = renderBusinessNotifyEmail({
    toEmail: "owner@example.com",
    subject: "New call",
    title: "New Customer Call Summary",
    status: { tone: "action", label: "Follow-up required", detail: "Callback <now>" },
    lines: [],
    sections: [
      { heading: "Call information", lines: [{ label: "Caller number", value: "(514) 555-0100" }, { label: "Duration", value: "2 min" }] },
      { heading: "Customer information", lines: [{ label: "Name", value: "Jade <Tremblay>" }, { label: "Email", value: null }] },
      { heading: "Conversation summary", lines: [], body: "Needs a plumber tomorrow." },
    ],
    ctaUrl: "https://tradecatch.ca/app/receptionist?call=rcs_1",
    ctaLabel: "View call",
  });

  it("gives every label the same fixed column, so values line up across sections", () => {
    const labels = html.match(/<td class="tc-l" width="38%"/g) ?? [];
    assert.equal(labels.length, 3, "one per filled row; the empty email row is left out");
    assert.equal((html.match(/table-layout:fixed/g) ?? []).length, 2);
  });

  it("shows the status banner, stacks on phones, and escapes values", () => {
    assert.match(html, /Follow-up required/);
    assert.match(html, /Callback &lt;now&gt;/);
    assert.match(html, /Jade &lt;Tremblay&gt;/);
    assert.match(html, /@media only screen and \(max-width:480px\)/);
    assert.match(html, /name="viewport"/);
    assert.match(html, /href="https:\/\/tradecatch\.ca\/app\/receptionist\?call=rcs_1"/);
  });
});
