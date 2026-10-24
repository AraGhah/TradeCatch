import { getSaasStore } from "@/product/saas/runtime";
import type { Organization } from "@/product/saas/types";

/** Operator-controlled enrollment, never a customer-editable business flag. */
export function googleCalendarPilotAllowed(
  org: Pick<
    Organization,
    "id" | "status" | "accountType" | "plan" | "features"
  > | null,
  enrolled = process.env.GOOGLE_CALENDAR_PILOT_ORG_IDS ?? "",
) {
  return Boolean(
    org &&
    org.status === "active" &&
    org.accountType === "pilot" &&
    org.plan === "growth" &&
    org.features.appointmentBooking &&
    enrolled
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(org.id),
  );
}

export async function hasGoogleCalendarPilot(organizationId: string) {
  return googleCalendarPilotAllowed(
    await getSaasStore().getOrganization(organizationId),
  );
}

export function calendarPilotDenied() {
  return Response.json(
    {
      error:
        "Google Calendar is available only to explicitly enrolled Growth pilot businesses.",
      code: "calendar_pilot_required",
    },
    { status: 403 },
  );
}
