import type { OpenGoogleFn } from "../../../src/product/scheduling/gcal/open";

/**
 * What the "choose a calendar" route does: open the business's own connection
 * (this is where the plan and tenant checks happen), then ask Google for the
 * calendars that connection can write to.
 */
export async function listGoogleCalendarsViaOpen(
  open: OpenGoogleFn,
  organizationId: string,
): Promise<
  | { ok: true; calendars: { id: string; summary: string }[] }
  | { ok: false; reason: string }
> {
  const opened = await open(organizationId, { selecting: true });
  if (!opened.ok) return { ok: false, reason: opened.reason };
  const result = await opened.client.listCalendars();
  if (!result.ok) return { ok: false, reason: result.kind };
  return { ok: true, calendars: result.calendars };
}
