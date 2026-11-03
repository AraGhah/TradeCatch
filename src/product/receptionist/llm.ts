/**
 * Minimal LLM client over fetch (Cloudflare Workers compatible — no SDK).
 *
 * Providers:
 * - `openai` (default when OPENAI_API_KEY or RECEPTIONIST_LLM_BASE_URL is set):
 *   any OpenAI-compatible /chat/completions endpoint — OpenAI itself (default
 *   model `gpt-6-luna`), or a self-hosted Ollama / vLLM / LocalAI via
 *   RECEPTIONIST_LLM_BASE_URL (then RECEPTIONIST_LLM_MODEL is required).
 * - `anthropic` (used when only ANTHROPIC_API_KEY is set, or when asked for with
 *   RECEPTIONIST_LLM_PROVIDER=anthropic): Messages API with a forced tool call
 *   for structured output.
 *
 * `resolveLlmConfig` is the single place that decides provider and model; the
 * client factory and the provider health probe both use it, so they cannot
 * disagree about what is being called.
 */

export type LlmProvider = "anthropic" | "openai";

export type LlmClient = {
  provider: LlmProvider;
  model: string;
  /** Returns the parsed JSON object produced by the model. */
  generateJson(input: {
    system: string;
    user: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
  }): Promise<unknown>;
  generateText(input: {
    system: string;
    user: string;
    maxTokens?: number;
  }): Promise<string>;
};

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
/** Used on api.openai.com when RECEPTIONIST_LLM_MODEL is not set. */
export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

const REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type LlmConfig =
  | { provider: "anthropic"; apiKey: string; model: string }
  | {
      provider: "openai";
      apiKey?: string;
      baseUrl: string;
      model: string;
      /** True when the endpoint is OpenAI itself rather than a self-hosted server. */
      hosted: boolean;
      reasoningEffort?: ReasoningEffort;
    };

/**
 * Decides provider, model and endpoint from the environment. Pure: no logging,
 * no network. `warning` explains why a requested or implied provider cannot be
 * used (the caller then falls back to the rule brain).
 */
export function resolveLlmConfig(env: Partial<NodeJS.ProcessEnv>): {
  config: LlmConfig | null;
  warning?: string;
} {
  const requested = env.RECEPTIONIST_LLM_PROVIDER?.trim().toLowerCase();
  if (requested === "none" || requested === "rules") return { config: null };

  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const customBaseUrl = env.RECEPTIONIST_LLM_BASE_URL?.trim();
  const modelOverride = env.RECEPTIONIST_LLM_MODEL?.trim();

  // OpenAI first. A deployment that still has both keys and a Claude model
  // pinned in RECEPTIONIST_LLM_MODEL keeps calling Claude rather than sending
  // a Claude model name to OpenAI.
  const pinnedToClaude =
    !requested && Boolean(anthropicKey) && /^claude/i.test(modelOverride ?? "");
  const provider: LlmProvider | null =
    requested === "anthropic" || requested === "openai"
      ? requested
      : pinnedToClaude
        ? "anthropic"
        : openaiKey || customBaseUrl
          ? "openai"
          : anthropicKey
            ? "anthropic"
            : null;
  if (!provider) return { config: null };

  if (provider === "anthropic") {
    if (!anthropicKey) {
      return {
        config: null,
        warning:
          "RECEPTIONIST_LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY — using rule brain",
      };
    }
    return {
      config: {
        provider,
        apiKey: anthropicKey,
        model: modelOverride || DEFAULT_ANTHROPIC_MODEL,
      },
    };
  }

  const hosted = !customBaseUrl;
  if (hosted && !openaiKey) {
    return {
      config: null,
      warning:
        "The openai provider needs OPENAI_API_KEY (or RECEPTIONIST_LLM_BASE_URL for a self-hosted server) — using rule brain",
    };
  }
  // A self-hosted server has no meaningful default model name; require one.
  const model = modelOverride || (hosted ? DEFAULT_OPENAI_MODEL : undefined);
  if (!model) {
    return {
      config: null,
      warning:
        "RECEPTIONIST_LLM_MODEL is required with RECEPTIONIST_LLM_BASE_URL — using rule brain",
    };
  }
  const effort = env.RECEPTIONIST_LLM_REASONING_EFFORT?.trim().toLowerCase();
  return {
    config: {
      provider,
      apiKey: openaiKey,
      baseUrl: (customBaseUrl || OPENAI_BASE_URL).replace(/\/$/, ""),
      model,
      hosted,
      // Only sent to OpenAI itself, and only when the operator asks for it.
      reasoningEffort:
        hosted && REASONING_EFFORTS.includes(effort as ReasoningEffort)
          ? (effort as ReasoningEffort)
          : undefined,
    },
  };
}

export function createLlmClientFromEnv(
  env: Partial<NodeJS.ProcessEnv> = process.env,
  fetchImpl: typeof fetch = fetch,
): LlmClient | null {
  const { config, warning } = resolveLlmConfig(env);
  if (warning) console.warn(`[receptionist] ${warning}`);
  if (!config) return null;

  const timeoutMs = Number(env.RECEPTIONIST_LLM_TIMEOUT_MS) || 4500;
  if (config.provider === "anthropic") {
    return createAnthropicClient({
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs,
      fetchImpl,
    });
  }
  return createOpenAiCompatibleClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    timeoutMs,
    fetchImpl,
  });
}

function createAnthropicClient(opts: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): LlmClient {
  async function call(body: Record<string, unknown>) {
    const res = await opts.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: opts.model, ...body }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(
        `Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    return (await res.json()) as {
      content?: {
        type: string;
        text?: string;
        input?: unknown;
        name?: string;
      }[];
    };
  }

  return {
    provider: "anthropic",
    model: opts.model,
    async generateJson({ system, user, schema, maxTokens = 500 }) {
      const json = await call({
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        tools: [
          {
            name: "respond",
            description: "Return the receptionist's next move.",
            input_schema: schema,
          },
        ],
        tool_choice: { type: "tool", name: "respond" },
      });
      const block = json.content?.find((c) => c.type === "tool_use");
      if (!block || block.input === undefined) {
        throw new Error("Anthropic response had no tool_use block");
      }
      return block.input;
    },
    async generateText({ system, user, maxTokens = 400 }) {
      const json = await call({
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      });
      return (json.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
        .trim();
    },
  };
}

function createOpenAiCompatibleClient(opts: {
  apiKey?: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): LlmClient {
  async function call(body: Record<string, unknown>) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
    const res = await opts.fetchImpl(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        ...(opts.reasoningEffort
          ? { reasoning_effort: opts.reasoningEffort }
          : {}),
        ...body,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content ?? "";
  }

  return {
    provider: "openai",
    model: opts.model,
    async generateJson({ system, user, schema }) {
      const content = await call({
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${system}\n\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`,
          },
          { role: "user", content: user },
        ],
      });
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("LLM returned no JSON object");
      return JSON.parse(match[0]) as unknown;
    },
    async generateText({ system, user }) {
      const content = await call({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      return content.trim();
    },
  };
}
