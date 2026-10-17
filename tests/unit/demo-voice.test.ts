import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/receptionist/demo/voice/route";
import {
  DEMO_ELEVEN_VOICES,
  demoSpeechText,
  demoVoiceId,
} from "../../src/lib/demo-voice";

describe("demo ElevenLabs voices", () => {
  it("uses the chosen voice for each language", () => {
    assert.equal(demoVoiceId("en"), "y0s2ExEMuum3muUnA6Zd");
    assert.equal(demoVoiceId("fr"), "j9RedbMRSNQ74PyikQwD");
    assert.equal(DEMO_ELEVEN_VOICES.en, demoVoiceId("en"));
    assert.equal(DEMO_ELEVEN_VOICES.fr, demoVoiceId("fr"));
  });

  it("keeps a spoken reply to one clean line", () => {
    assert.equal(demoSpeechText("  Bonjour   le   monde  "), "Bonjour le monde");
    assert.equal(demoSpeechText(""), null);
    assert.equal(demoSpeechText("   "), null);
    assert.equal(demoSpeechText("a".repeat(801)), null);
  });

  it("does not call ElevenLabs when the key is missing", async () => {
    const previous = process.env.ELEVENLABS_API_KEY;
    const demo = process.env.RECEPTIONIST_DEMO;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.RECEPTIONIST_DEMO;
    try {
      const res = await POST(
        new NextRequest("http://localhost/api/receptionist/demo/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ locale: "fr", text: "Bonjour" }),
        }),
      );
      assert.equal(res.status, 503);
    } finally {
      if (previous === undefined) delete process.env.ELEVENLABS_API_KEY;
      else process.env.ELEVENLABS_API_KEY = previous;
      if (demo === undefined) delete process.env.RECEPTIONIST_DEMO;
      else process.env.RECEPTIONIST_DEMO = demo;
    }
  });
});
