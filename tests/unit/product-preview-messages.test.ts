import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";

/**
 * The home hero and sign-in phone (TradeCatchProductPreview) resolve every
 * string on the server. check:i18n only compares EN with FR, so a key missing
 * from both ships as a raw "productPreview.x" on the page. This reads the keys
 * the component asks for and checks each one exists, as a string, in both.
 */
const source = readFileSync(
  new URL(
    "../../src/components/ui/tradecatch-product-preview.tsx",
    import.meta.url,
  ),
  "utf8",
);
const keys = [...source.matchAll(/\bt\("([A-Za-z0-9]+)"\)/g)].map(
  (match) => match[1],
);

test("the product preview asks for its strings", () => {
  assert.ok(keys.length > 20, `found only ${keys.length} keys`);
});

for (const [locale, messages] of [
  ["en", en],
  ["fr", fr],
] as const) {
  test(`every product preview string exists in ${locale}`, () => {
    const block = (messages as Record<string, unknown>).productPreview as
      | Record<string, unknown>
      | undefined;
    assert.ok(block, "productPreview namespace is missing");
    const missing = keys.filter(
      (key) => typeof block[key] !== "string" || block[key] === "",
    );
    assert.deepEqual(missing, []);
  });
}
