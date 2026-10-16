import { getSchedulingService } from "./runtime";
import type { BookResult } from "./service";

/**
 * The receptionist may speak a confirmation only when `confirmed` is true.
 * Availability and the reservation both come from the scheduling backend.
 */
export async function aiListOpenings(input: {
  organizationId: string;
  serviceId?: string;
  serviceAddress?: string;
  from?: string;
  until?: string;
}) {
  const result = await getSchedulingService().availability(input);
  return {
    confirmed: false as const,
    slots: result.slots.map((slot) => ({
      startAt: slot.startAt,
      endAt: slot.endAt,
      label: slot.localLabel,
      technicianName: slot.technicianName,
    })),
  };
}

export async function aiReserveAppointment(input: {
  organizationId: string;
  serviceId?: string;
  serviceName?: string;
  startAt: string;
  customerName?: string;
  customerPhoneE164?: string;
  serviceAddress?: string;
  idempotencyKey?: string;
  simulated?: boolean;
}): Promise<BookResult> {
  return getSchedulingService().book({
    ...input,
    source: input.simulated ? "simulation" : "ai_receptionist",
  });
}
