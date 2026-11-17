import { orgHasFeature } from "@/product/saas/entitlements";
import { getSaasStore } from "@/product/saas/runtime";
import type { Organization } from "@/product/saas/types";

/**
 * Google Calendar is switched on one business at a time, by the operator, after
 * it has been tested with that business's own calendar. It needs a plan that
 * includes appointments (Professional), an active non-demo account, and the
 * business's id on the enrollment list. It is never a customer-editable flag.
 */
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
    org.accountType !== "demo" &&
    orgHasFeature(org.plan, "APPOINTMENT_BOOKING") &&
    org.features.appointmentBooking &&
    enrolled
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(org.id),
  );
}

/**
 * Cal.com follows the same rule as Google Calendar: a plan with appointments,
 * an active non-demo account, and the business's id on the operator's list
 * (CALCOM_ORG_IDS). Never a customer-editable flag.
 */
export function calcomAllowed(
  org: Parameters<typeof googleCalendarPilotAllowed>[0],
  enrolled = process.env.CALCOM_ORG_IDS ?? "",
) {
  return googleCalendarPilotAllowed(org, enrolled);
}

export async function hasCalcomAccess(organizationId: string) {
  return calcomAllowed(await getSaasStore().getOrganization(organizationId));
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
        "Google Calendar is available only on the Professional plan, once it has been switched on for your business.",
      code: "calendar_pilot_required",
    },
    { status: 403 },
  );
}
