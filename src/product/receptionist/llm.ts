/**
 * Minimal LLM client over fetch (Cloudflare Workers compatible — no SDK).
 *
 * Providers:
 * - `anthropic` (default when ANTHROPIC_API_KEY is set): Messages API with a
 *   forced tool call for structured output.
 * - `openai`: any OpenAI-compatible /chat/completions endpoint — OpenAI, or a
 *   self-hosted Ollama / vLLM / LocalAI via RECEPTIONIST_LLM_BASE_URL.
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

export function createLlmClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): LlmClient | null {
  const requested = env.RECEPTIONIST_LLM_PROVIDER?.trim().toLowerCase();
  if (requested === "none" || requested === "rules") return null;

  const timeoutMs = Number(env.RECEPTIONIST_LLM_TIMEOUT_MS) || 4500;
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const baseUrl = env.RECEPTIONIST_LLM_BASE_URL?.trim();

  const provider: LlmProvider | null =
    requested === "anthropic" || requested === "openai"
      ? requested
      : anthropicKey
        ? "anthropic"
        : openaiKey || baseUrl
          ? "openai"
          : null;
  if (!provider) return null;

  if (provider === "anthropic") {
    if (!anthropicKey) return null;
    const model = env.RECEPTIONIST_LLM_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
    return createAnthropicClient({
      apiKey: anthropicKey,
      model,
      timeoutMs,
      fetchImpl,
    });
  }

  const model = env.RECEPTIONIST_LLM_MODEL?.trim();
  if (!model) {
    console.warn(
      "[receptionist] RECEPTIONIST_LLM_MODEL is required for the openai-compatible provider — using rule brain",
    );
    return null;
  }
  return createOpenAiCompatibleClient({
    apiKey: openaiKey,
    baseUrl: (baseUrl || "https://api.openai.com/v1").replace(/\/$/, ""),
    model,
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
      body: JSON.stringify({ model: opts.model, ...body }),
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
