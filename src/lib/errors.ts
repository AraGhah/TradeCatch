const DISCORD_WEBHOOK_RE =
  /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//i;
const SLACK_WEBHOOK_RE = /^https:\/\/hooks\.slack\.com\/services\//i;

/** Discord embed field value/name limits — truncate so a long stack never gets the whole webhook rejected. */
function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function contextFields(context: Record<string, unknown>) {
  return Object.entries(context)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .slice(0, 24) // Discord allows at most 25 embed fields.
    .map(([name, value]) => ({
      name: clip(name, 256),
      value: clip(String(value), 1024),
      inline: true,
    }));
}

/**
 * Discord's incoming-webhook API rejects arbitrary JSON — it requires
 * `content` and/or `embeds`. Build a payload it will actually accept and
 * display.
 */
function buildDiscordPayload(
  message: string,
  stack: string | undefined,
  context: Record<string, unknown>,
) {
  const fields = contextFields(context);
  if (stack) {
    fields.push({
      name: "Stack",
      value: clip(`\`\`\`${stack}\`\`\``, 1024),
      inline: false,
    });
  }
  return {
    content: null,
    embeds: [
      {
        title: "TradeCatch error",
        description: clip(message, 4096),
        color: 0xdc2626,
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/** Slack's incoming-webhook API requires a top-level `text` field. */
function buildSlackPayload(
  message: string,
  stack: string | undefined,
  context: Record<string, unknown>,
) {
  const contextLine = Object.entries(context)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `*${k}*: ${v}`)
    .join(" · ");
  const stackBlock = stack ? `\n\`\`\`${clip(stack, 2800)}\`\`\`` : "";
  return {
    text: `:rotating_light: *TradeCatch error*\n${clip(message, 2800)}${
      contextLine ? `\n${contextLine}` : ""
    }${stackBlock}`,
  };
}

/**
 * Optional error reporting to an external monitor (Sentry webhook, Better Stack,
 * Discord/Slack incoming webhook, etc.). Configure ERROR_WEBHOOK_URL.
 *
 * Never throws — monitoring must not break the user path.
 */
export async function reportError(
  error: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  const webhookUrl = process.env.ERROR_WEBHOOK_URL?.trim();
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  const stack = error instanceof Error ? error.stack : undefined;

  console.error("[error]", message, context);

  if (!webhookUrl) return;

  const payload = DISCORD_WEBHOOK_RE.test(webhookUrl)
    ? buildDiscordPayload(message, stack, context)
    : SLACK_WEBHOOK_RE.test(webhookUrl)
      ? buildSlackPayload(message, stack, context)
      : {
          source: "tradecatch",
          message,
          stack,
          context,
          at: new Date().toISOString(),
        };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4_000),
    });
  } catch (sendError) {
    console.error("[error] webhook failed", sendError);
  }
}
