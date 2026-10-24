import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { it } from "node:test";
import {
  HELP_ARTICLES,
  getHelpArticle,
  searchHelp,
} from "../../src/product/support/help";

it("every help article has complete bilingual practical guidance and a real local PNG", () => {
  for (const source of HELP_ARTICLES) {
    for (const locale of ["en", "fr"] as const) {
      const article = getHelpArticle(source.id, locale)!;
      assert.ok(article.steps.length >= 4);
      assert.ok(article.steps.every((step) => step.length > 40));
      assert.ok(article.expected.length > 60);
      assert.ok(article.troubleshooting.length >= 2);
      const imagePath = `public${article.screenshot.src}`;
      assert.ok(existsSync(imagePath), imagePath);
      const png = readFileSync(imagePath);
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.ok(png.readUInt32BE(16) >= 400);
      assert.ok(png.readUInt32BE(20) >= 100);
      assert.ok(article.screenshot.caption.length > 40);
    }
  }
  assert.equal(getHelpArticle("nonexistent", "fr"), null);
});

it("help search includes troubleshooting and setup steps in either language", () => {
  assert.ok(searchHelp("OAuth", "en").some((row) => row.id === "calendar"));
  assert.ok(
    searchHelp("désabonnement", "fr").some((row) => row.id === "automations"),
  );
  assert.ok(
    searchHelp("manifest.json", "fr").some((row) => row.id === "account"),
  );
});
