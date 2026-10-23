import type { BookAuditContactPayload } from "@/lib/validation/book-audit";

/**
 * Optional external forwarding of TradeCatch's own sales bookings.
 * Native platform sales CRM synchronization is independent and atomic with storage.
 * Contractor-specific CRM webhooks remain scoped through product/growth integrations.
 *
 * Configure LEADS_WEBHOOK_URL with a POST endpoint that accepts JSON.
 * Returns { forwarded: false } when unset — emails still go out.
 */
export async function forwardLeadToCrm(
  payload: BookAuditContactPayload,
  idempotencyKey?: string,
  receivedAt = new Date().toISOString(),
): Promise<{ forwarded: boolean }> {
  const webhookUrl = process.env.LEADS_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return { forwarded: false };
  }

  const body = {
    source: "tradecatch-book-audit",
    receivedAt,
    lead: {
      firstName: payload.firstName,
      lastName: payload.lastName,
      company: payload.company,
      trade: payload.trade,
      email: payload.email,
      phone: payload.phone,
      city: payload.city,
      preferredLanguage: payload.preferredLanguage,
      employees: payload.employees || null,
      callsPerMonth: payload.callsPerMonth || null,
      missedCallsPerWeek: payload.missedCallsPerWeek || null,
      afterHours: payload.afterHours || null,
      quotesPerMonth: payload.quotesPerMonth || null,
      averageJobValue: payload.averageJobValue || null,
      currentCrm: payload.currentCrm || null,
      handlesMissedCalls: payload.handlesMissedCalls || null,
      followsUpQuotes: payload.followsUpQuotes || null,
      mainProblem: payload.mainProblem || null,
      marketingConsent: payload.marketingConsent,
    },
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(process.env.LEADS_WEBHOOK_SECRET
          ? { Authorization: `Bearer ${process.env.LEADS_WEBHOOK_SECRET}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      console.error("[leads] CRM webhook returned non-OK status", {
        status: response.status,
      });
      return { forwarded: false };
    }

    return { forwarded: true };
  } catch (error) {
    console.error("[leads] CRM webhook failed", error);
    return { forwarded: false };
  }
}
