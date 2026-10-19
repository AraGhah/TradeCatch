/**
 * Per-organization CRM/automation webhook forwarder (Zapier, Make, HubSpot, etc.).
 * Failures go to growth CRM DLQ for retry — not silent drop.
 *
 * The destination is typed in by the customer, so it is checked again here
 * (not only when it was saved), redirects are never followed, and failures are
 * reported as fixed codes: raw network errors would tell the customer which
 * internal hosts and ports answer.
 */

import {
  checkOutboundUrl,
  hostResolution,
  type HostResolver,
} from "./safe-url";

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
  deps: { fetchImpl?: typeof fetch; resolver?: HostResolver } = {},
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const raw = webhookUrl.trim();
  if (!raw) return { ok: false, error: "missing_url" };

  const checked = checkOutboundUrl(raw);
  if (!checked.ok) return { ok: false, error: "blocked_url" };
  if (
    (await hostResolution(checked.url.hostname, deps.resolver)) === "non-public"
  ) {
    return { ok: false, error: "blocked_url" };
  }

  const body = {
    source: "tradecatch-product",
    eventType: event.eventType,
    organizationId: event.organizationId,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    data: event.data,
  };

  try {
    const response = await (deps.fetchImpl ?? fetch)(checked.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(secret?.trim() ? { Authorization: `Bearer ${secret.trim()}` } : {}),
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status >= 300 && response.status < 400) {
      // A redirect could lead somewhere the checks above never saw (and would
      // carry the bearer secret with it).
      return {
        ok: false,
        status: response.status,
        error: "redirect_not_followed",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `http_${response.status}`,
      };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    const timedOut =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, error: timedOut ? "timeout" : "network_error" };
  }
}
