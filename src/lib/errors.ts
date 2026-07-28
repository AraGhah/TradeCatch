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

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "tradecatch",
        message,
        stack,
        context,
        at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(4_000),
    });
  } catch (sendError) {
    console.error("[error] webhook failed", sendError);
  }
}
