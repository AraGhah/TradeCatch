import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  OPENAI_BASE_URL,
  createLlmClientFromEnv,
  resolveLlmConfig,
} from "../../src/product/receptionist/llm";
import { providerProbes } from "../../src/product/reliability/probes";

test("OpenAI is the default provider and gpt-6-luna the default model", () => {
  assert.equal(DEFAULT_OPENAI_MODEL, "gpt-6-luna");
  const { config, warning } = resolveLlmConfig({ OPENAI_API_KEY: "sk-test" });
  assert.equal(warning, undefined);
  assert.deepEqual(config, {
    provider: "openai",
    apiKey: "sk-test",
    baseUrl: OPENAI_BASE_URL,
    model: "gpt-6-luna",
    hosted: true,
    reasoningEffort: undefined,
  });
});

test("provider precedence: OpenAI first, Anthropic when it is the only key or asked for", () => {
  const both = { OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "ak-test" };
  assert.equal(resolveLlmConfig(both).config?.provider, "openai");
  assert.equal(
    resolveLlmConfig({ ANTHROPIC_API_KEY: "ak-test" }).config?.model,
    DEFAULT_ANTHROPIC_MODEL,
  );
  assert.equal(
    resolveLlmConfig({ ANTHROPIC_API_KEY: "ak-test" }).config?.provider,
    "anthropic",
  );
  assert.equal(
    resolveLlmConfig({ ...both, RECEPTIONIST_LLM_PROVIDER: "anthropic" }).config
      ?.provider,
    "anthropic",
  );
  // A deployment that pinned a Claude model keeps calling Claude, never sends
  // a Claude model name to OpenAI.
  const pinned = resolveLlmConfig({
    ...both,
    RECEPTIONIST_LLM_MODEL: "claude-sonnet-4-5",
  }).config;
  assert.equal(pinned?.provider, "anthropic");
  assert.equal(pinned?.model, "claude-sonnet-4-5");
});

test("RECEPTIONIST_LLM_MODEL overrides the OpenAI default", () => {
  const { config } = resolveLlmConfig({
    OPENAI_API_KEY: "sk-test",
    RECEPTIONIST_LLM_MODEL: "gpt-6-sol",
  });
  assert.equal(config?.model, "gpt-6-sol");
});

test("self-hosted servers must name their model and never get OpenAI-only options", () => {
  const base = {
    RECEPTIONIST_LLM_BASE_URL: "http://localhost:11434/v1/",
    RECEPTIONIST_LLM_REASONING_EFFORT: "low",
  };
  const missing = resolveLlmConfig(base);
  assert.equal(missing.config, null);
  assert.match(missing.warning ?? "", /RECEPTIONIST_LLM_MODEL is required/);

  const { config } = resolveLlmConfig({
    ...base,
    RECEPTIONIST_LLM_MODEL: "llama3.1",
  });
  assert.equal(config?.provider, "openai");
  assert.equal(config?.model, "llama3.1");
  if (config?.provider !== "openai") throw new Error("expected openai");
  assert.equal(config.hosted, false);
  assert.equal(config.baseUrl, "http://localhost:11434/v1");
  assert.equal(config.reasoningEffort, undefined);
});

test("nothing usable falls back to the rule brain, with a reason when a provider was asked for", () => {
  assert.equal(resolveLlmConfig({}).config, null);
  for (const mode of ["none", "rules"]) {
    assert.equal(
      resolveLlmConfig({
        OPENAI_API_KEY: "sk-test",
        RECEPTIONIST_LLM_PROVIDER: mode,
      }).config,
      null,
    );
  }
  const noKey = resolveLlmConfig({ RECEPTIONIST_LLM_PROVIDER: "openai" });
  assert.equal(noKey.config, null);
  assert.match(noKey.warning ?? "", /OPENAI_API_KEY/);
  const noAnthropic = resolveLlmConfig({
    RECEPTIONIST_LLM_PROVIDER: "anthropic",
    OPENAI_API_KEY: "sk-test",
  });
  assert.equal(noAnthropic.config, null);
  assert.match(noAnthropic.warning ?? "", /ANTHROPIC_API_KEY/);
});

function recordingFetch(reply: unknown) {
  const calls: {
    url: string;
    init: RequestInit;
    body: Record<string, unknown>;
  }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return Response.json(reply);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("the request to OpenAI names gpt-6-luna and sends only parameters every OpenAI model accepts", async () => {
  const { calls, fetchImpl } = recordingFetch({
    choices: [{ message: { content: '{"reply":"Hello"}' } }],
  });
  const client = createLlmClientFromEnv(
    { OPENAI_API_KEY: "sk-test" },
    fetchImpl,
  );
  assert.equal(client?.provider, "openai");
  assert.equal(client?.model, "gpt-6-luna");

  const json = await client!.generateJson({
    system: "You are a receptionist.",
    user: "Hi",
    schema: { type: "object" },
    maxTokens: 123,
  });
  assert.deepEqual(json, { reply: "Hello" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer sk-test");
  assert.equal(calls[0].body.model, "gpt-6-luna");
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  // Newer models reject max_tokens / non-default temperature; the client sends neither.
  for (const key of ["max_tokens", "temperature", "reasoning_effort"]) {
    assert.ok(!(key in calls[0].body), `${key} must not be sent by default`);
  }
});

test("reasoning effort is sent to OpenAI only when the operator sets a valid value", async () => {
  for (const [value, expected] of [
    ["low", "low"],
    [" HIGH ", "high"],
    ["turbo", undefined],
    ["", undefined],
  ] as const) {
    const { calls, fetchImpl } = recordingFetch({
      choices: [{ message: { content: "ok" } }],
    });
    const client = createLlmClientFromEnv(
      { OPENAI_API_KEY: "sk-test", RECEPTIONIST_LLM_REASONING_EFFORT: value },
      fetchImpl,
    );
    await client!.generateText({ system: "s", user: "u" });
    assert.equal(calls[0].body.reasoning_effort, expected, `value ${value}`);
  }
});

test("the AI receptionist health probe reads the model the receptionist will actually call", async () => {
  const env = { OPENAI_API_KEY: "sk-private-key" };
  const urls: string[] = [];
  const connected = await providerProbes(env, async (input) => {
    urls.push(String(input));
    return Response.json({ id: "gpt-6-luna", object: "model" });
  });
  assert.deepEqual(urls, ["https://api.openai.com/v1/models/gpt-6-luna"]);
  const probe = connected.find((p) => p.service === "ai_receptionist");
  assert.equal(probe?.state, "connected");
  assert.equal(probe?.status, "unknown");
  assert.ok(!JSON.stringify(connected).includes("sk-private-key"));

  // A model the key cannot use is a failure here, not a surprise on a live call.
  const missing = await providerProbes(env, async () =>
    Response.json({ error: { message: "no such model" } }, { status: 404 }),
  );
  assert.equal(
    missing.find((p) => p.service === "ai_receptionist")?.status,
    "unavailable",
  );

  // A different model id in the answer does not count as the configured model being available.
  const wrong = await providerProbes(env, async () =>
    Response.json({ id: "some-other-model" }),
  );
  assert.equal(
    wrong.find((p) => p.service === "ai_receptionist")?.status,
    "degraded",
  );

  // The probe follows RECEPTIONIST_LLM_MODEL, like the receptionist does.
  const custom: string[] = [];
  await providerProbes(
    { ...env, RECEPTIONIST_LLM_MODEL: "gpt-6-sol" },
    async (input) => {
      custom.push(String(input));
      return Response.json({ id: "gpt-6-sol" });
    },
  );
  assert.deepEqual(custom, ["https://api.openai.com/v1/models/gpt-6-sol"]);
});
