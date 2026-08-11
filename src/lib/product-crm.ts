/**
 * Per-organization CRM/automation webhook forwarder (Zapier, Make, HubSpot, etc.).
 * Failures go to growth CRM DLQ for retry — not silent drop.
 */

export type ProductCrmEvent = {
  eventType: string;
  organizationId: string;
  occurredAt?: string;
  data: Record<string, unknown>;
};

export async function forwardProductEventToCrm(
  webhookUrl: string,
  event: ProductCrmEvent,
  secret?: string | null,
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const url = webhookUrl.trim();
  if (!url) return { ok: false, error: "missing_url" };

  const body = {
    source: "tradecatch-product",
    eventType: event.eventType,
    organizationId: event.organizationId,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    data: event.data,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(secret?.trim()
          ? { Authorization: `Bearer ${secret.trim()}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `http_${response.status}`,
      };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "send_failed",
    };
  }
}
