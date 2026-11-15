import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFemaleVoiceName,
  isMaleVoiceName,
  pickReceptionistVoice,
} from "../../src/lib/browser-voice";

const v = (name: string, lang: string) => ({ name, lang });

describe("browser voice names", () => {
  it("recognises common female and male system voices", () => {
    for (const name of [
      "Microsoft Denise Online (Natural) - French (Canada)",
      "Microsoft Aria Online (Natural) - English (United States)",
      "Google UK English Female",
      "Amelie",
      "Samantha",
    ]) {
      assert.equal(isFemaleVoiceName(name), true, name);
      assert.equal(isMaleVoiceName(name), false, name);
    }
    for (const name of [
      "Microsoft Guy Online (Natural) - English (United States)",
      "Microsoft Antoine Online (Natural) - French (Canada)",
      "Google UK English Male",
      "Thomas",
    ]) {
      assert.equal(isMaleVoiceName(name), true, name);
      assert.equal(isFemaleVoiceName(name), false, name);
    }
  });

  it("does not take 'Female' for 'Male'", () => {
    assert.equal(isMaleVoiceName("Google UK English Female"), false);
  });
});

describe("pickReceptionistVoice", () => {
  it("prefers a female voice over a male one of the same region", () => {
    const picked = pickReceptionistVoice(
      [v("Microsoft Antoine Online", "fr-CA"), v("Microsoft Sylvie Online", "fr-CA")],
      "fr-CA",
    );
    assert.equal(picked?.name, "Microsoft Sylvie Online");
  });

  it("prefers a same-language female voice over an exact-region male one", () => {
    const picked = pickReceptionistVoice(
      [v("Microsoft Antoine Online", "fr-CA"), v("Amelie", "fr-FR")],
      "fr-CA",
    );
    assert.equal(picked?.name, "Amelie");
  });

  it("prefers an unrecognised voice over a recognised male one", () => {
    const picked = pickReceptionistVoice(
      [v("Google français", "fr-FR"), v("Thomas", "fr-FR")],
      "fr-FR",
    );
    assert.equal(picked?.name, "Google français");
  });

  it("falls back to a male voice rather than no voice, and never to another language", () => {
    assert.equal(
      pickReceptionistVoice([v("Thomas", "fr-FR"), v("Zira", "en-US")], "fr-CA")?.name,
      "Thomas",
    );
    assert.equal(pickReceptionistVoice([v("Zira", "en-US")], "fr-CA"), null);
    assert.equal(pickReceptionistVoice([], "fr-CA"), null);
  });

  it("keeps the browser order when voices are otherwise equal, and accepts '_' in lang", () => {
    const picked = pickReceptionistVoice(
      [v("Voice One", "en_CA"), v("Voice Two", "en_CA")],
      "en-CA",
    );
    assert.equal(picked?.name, "Voice One");
  });
});
