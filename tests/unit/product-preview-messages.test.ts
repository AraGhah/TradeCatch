import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import { receptionistCallCopy } from "../../src/components/ui/receptionist-call-copy";

/**
 * The home hero phone (TradeCatchProductPreview) resolves every string on the
 * server. check:i18n only compares EN with FR, so a key missing from both
 * ships as a raw "productPreview.x" on the page. These tests resolve the call
 * for every combination of launch flags against both locales, and pin what
 * each flag is allowed to promise.
 */
const LOCALES = [
  ["en", en],
  ["fr", fr],
] as const;
const FLAGS = [
  { booking: false, transfer: false },
  { booking: true, transfer: false },
  { booking: false, transfer: true },
  { booking: true, transfer: true },
];

function translator(messages: unknown, used: Set<string>) {
  const block = (messages as Record<string, unknown>).productPreview;
  return (key: string) => {
    used.add(key);
    let node: unknown = block;
    for (const part of key.split(".")) {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
    if (typeof node !== "string" || node === "") {
      throw new Error(`productPreview.${key} is missing`);
    }
    return node;
  };
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((item) => strings(item, out));
  return out;
}

const wrapper = readFileSync(
  new URL("../../src/components/ui/tradecatch-product-preview.tsx", import.meta.url),
  "utf8",
);
const wrapperKeys = [...wrapper.matchAll(/\bt\("([A-Za-z0-9.]+)"\)/g)].map((m) => m[1]!);

for (const [locale, messages] of LOCALES) {
  describe(`${locale}: hero call phone`, () => {
    test("the frame's own strings exist", () => {
      assert.ok(wrapperKeys.length >= 4, `found only ${wrapperKeys.length} keys`);
      const used = new Set<string>();
      const t = translator(messages, used);
      for (const key of wrapperKeys) t(key);
    });

    for (const flags of FLAGS) {
      const name = `booking ${flags.booking ? "on" : "off"}, transfer ${flags.transfer ? "on" : "off"}`;

      test(`${name}: every string resolves and the story is in order`, () => {
        const copy = receptionistCallCopy(translator(messages, new Set()), flags);
        const { lines, marks } = copy;
        assert.equal(lines[marks.need]!.who, "caller");
        assert.equal(lines[marks.urgency]!.who, "caller");
        assert.equal(lines[marks.details]!.who, "caller");
        assert.equal(lines[marks.workStart]!.who, "agent");
        assert.equal(lines[marks.pick]!.who, "caller");
        assert.equal(lines[marks.workEnd]!.who, "agent");
        assert.equal(lines[marks.handoff]!.who, "agent");
        assert.equal(marks.handoff, lines.length - 1);
        assert.equal(marks.offer !== null, flags.booking);
        assert.ok(marks.need < marks.urgency && marks.urgency < marks.details);
        assert.ok(marks.details < marks.workStart && marks.workStart < marks.pick);
        assert.ok(marks.pick < marks.workEnd && marks.workEnd < marks.handoff);
        assert.equal(copy.fields.length, 5);
        assert.ok(copy.rows[copy.outcomeRow]);
      });

      test(`${name}: promises only what the flags allow`, () => {
        const used = new Set<string>();
        const all = strings(receptionistCallCopy(translator(messages, used), flags));
        const transferKeys = [...used].filter((key) => key.startsWith("voice.transfer."));
        const transferText = strings(messages.productPreview.voice.transfer);
        if (flags.transfer) {
          assert.ok(transferKeys.length >= 5, "transfer flag on shows the transfer");
        } else {
          assert.deepEqual(transferKeys, [], "transfer flag off: no transfer strings");
          for (const text of transferText) assert.ok(!all.includes(text), text);
        }
        const bookingKeys = [...used].filter((key) =>
          /^voice\.(cal[A-Z]|slot|line(Check|Offer|Pick|Confirm)Booked|notifyBodyBooked|rowOutcomeBooked|summaryBooked|chipConfirmation)/.test(key),
        );
        if (flags.booking) assert.ok(bookingKeys.length > 8);
        else assert.deepEqual(bookingKeys, [], "scheduling not verified: nothing booked");
      });
    }
  });
}

test("the home page passes the operator's launch flags to the hero phone", () => {
  const page = readFileSync(new URL("../../src/app/[locale]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /showScheduling=\{schedulingVerified\(\)\}/);
  assert.match(page, /showTransfer=\{launchFlagEnabled\("callTransfer"\)\}/);
});
