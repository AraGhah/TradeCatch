import assert from "node:assert/strict";
import { test } from "node:test";
import { createLlmClientFromEnv } from "../../src/product/receptionist/llm";
import { smsLlmEnv } from "../../src/product/sms-receptionist/runtime";

test("texts get a longer model budget than calls, bounded and configurable", () => {
  assert.equal(smsLlmEnv({}).RECEPTIONIST_LLM_TIMEOUT_MS, "10000");
  // The voice budget must not leak into SMS.
  assert.equal(
    smsLlmEnv({ RECEPTIONIST_LLM_TIMEOUT_MS: "4500" }).RECEPTIONIST_LLM_TIMEOUT_MS,
    "10000",
  );
  assert.equal(smsLlmEnv({ SMS_LLM_TIMEOUT_MS: "7000" }).RECEPTIONIST_LLM_TIMEOUT_MS, "7000");
  assert.equal(smsLlmEnv({ SMS_LLM_TIMEOUT_MS: "999999" }).RECEPTIONIST_LLM_TIMEOUT_MS, "20000");
  for (const bad of ["", "abc", "0", "-5", "200"])
    assert.equal(
      smsLlmEnv({ SMS_LLM_TIMEOUT_MS: bad }).RECEPTIONIST_LLM_TIMEOUT_MS,
      "10000",
      `ignores ${JSON.stringify(bad)}`,
    );
});

test("the SMS environment keeps the provider and model choice untouched", async () => {
  const seen: { url: string; model: string }[] = [];
  const env = smsLlmEnv({
    OPENAI_API_KEY: "sk-test-not-real",
    RECEPTIONIST_LLM_PROVIDER: "openai",
    RECEPTIONIST_LLM_MODEL: "gpt-6-luna",
  });
  const client = createLlmClientFromEnv(env, async (url, init) => {
    seen.push({
      url: String(url),
      model: JSON.parse(String(init?.body)).model,
    });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    );
  });
  assert.equal(client?.provider, "openai");
  assert.equal(await client?.generateText({ system: "s", user: "u" }), "ok");
  assert.deepEqual(seen, [
    { url: "https://api.openai.com/v1/chat/completions", model: "gpt-6-luna" },
  ]);
});
