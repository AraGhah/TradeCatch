/**
 * Phone booking adapter — connects the call engine to the scheduling service.
 *
 * The scheduling service owns availability, the reservation lock, the calendar
 * and the confirmation notices. This module only decides *which service type*
 * a call is for and translates results; it never decides a time is free.
 */

import type { SchedulingService } from "@/product/scheduling/service";
import type { ServiceType } from "@/product/scheduling/types";
import type { ReceptionistScheduler, OpenSlot } from "./booking";
import { normalizeSpeech } from "./nlu";
import type { ReceptionistConfig } from "./types";

export const GENERIC_SERVICE_NAME = {
  fr: "Appel de service",
  en: "Service call",
} as const;

/** Words that carry no meaning in a service name. */
const NOISE_WORDS = new Set([
  "service",
  "services",
  "visit",
  "appointment",
  "call",
  "work",
  "job",
  "general",
  "standard",
]);

/**
 * Words that describe many jobs ("repair"), so they cannot pick one bookable
 * service. They still count when a service that needs approval is named, so a
 * "Major installation" is never auto-confirmed because a caller said "install".
 */
const GENERIC_WORDS = new Set([
  "repair",
  "repairs",
  "inspection",
  "consultation",
  "installation",
  "install",
]);

const STOP_WORDS = new Set(["and", "the", "for", "with", "des", "les", "pour"]);

const stem = (word: string) => word.slice(0, 5);

function words(text: string | undefined): string[] {
  return normalizeSpeech(text ?? "")
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !NOISE_WORDS.has(w));
}

/** Only these may be reserved without a person reviewing the request. */
function bookableByPhone(service: ServiceType): boolean {
  return (
    service.bookingMode === "automatic" ||
    service.bookingMode === "consultation"
  );
}

export type ServiceChoice =
  | { kind: "service"; service: ServiceType }
  | { kind: "generic" }
  /** The caller's words point at a service that needs approval or escalation. */
  | { kind: "needs_review" };

/**
 * Which service type a call is for.
 *
 * - A service that needs approval (or is an emergency) wins on *any* shared
 *   word, so it can never be auto-confirmed by accident.
 * - A bookable service must have every distinguishing word of its name spoken.
 * - Otherwise a plain visit of the default length is offered.
 */
export function chooseService(
  services: ServiceType[],
  issue: string | undefined,
): ServiceChoice {
  const active = services.filter((s) => s.active);
  const spoken = words(issue);
  if (spoken.length === 0) return { kind: "generic" };
  const spokenStems = new Set(spoken.map(stem));

  // A word that appears in several service names ("plumbing") says nothing.
  const frequency = new Map<string, number>();
  for (const service of active) {
    for (const w of new Set(words(service.name).map(stem))) {
      frequency.set(w, (frequency.get(w) ?? 0) + 1);
    }
  }
  const distinctive = (w: string) => (frequency.get(stem(w)) ?? 0) < 2;

  for (const service of active.filter((s) => !bookableByPhone(s))) {
    if (
      words(service.name).some(
        (w) => distinctive(w) && spokenStems.has(stem(w)),
      )
    ) {
      return { kind: "needs_review" };
    }
  }

  const matches = active
    .filter(bookableByPhone)
    .map((service) => ({
      service,
      distinguishing: words(service.name)
        .filter((w) => !GENERIC_WORDS.has(w) && distinctive(w))
        .map(stem),
    }))
    .filter(
      ({ distinguishing }) =>
        distinguishing.length > 0 &&
        distinguishing.every((w) => spokenStems.has(w)),
    )
    .sort(
      (a, b) =>
        b.distinguishing.length - a.distinguishing.length ||
        a.service.name.localeCompare(b.service.name),
    );
  return matches[0]
    ? { kind: "service", service: matches[0].service }
    : { kind: "generic" };
}

export type PhoneSchedulerDeps = {
  scheduling(): Promise<SchedulingService>;
  /** The business behind a receptionist config, when it can take bookings. */
  findOrganizationId(config: ReceptionistConfig): Promise<string | null>;
};

const toOpen = (slot: { startAt: string; endAt: string }): OpenSlot => ({
  startAt: slot.startAt,
  endAt: slot.endAt,
});

export function createPhoneScheduler(
  deps: PhoneSchedulerDeps,
): ReceptionistScheduler {
  return {
    async listOpenings(input) {
      const organizationId = await deps.findOrganizationId(input.config);
      if (!organizationId) return { ok: false, reason: "not_bookable" };
      const scheduling = await deps.scheduling();
      const services = await scheduling.listServices(organizationId);

      let service: ServiceType | undefined;
      if (input.serviceId) {
        service = services.find((s) => s.id === input.serviceId && s.active);
        if (!service || !bookableByPhone(service)) {
          return { ok: false, reason: "not_bookable" };
        }
      } else {
        const choice = chooseService(services, input.issue);
        if (choice.kind === "needs_review") {
          return { ok: false, reason: "not_bookable" };
        }
        service = choice.kind === "service" ? choice.service : undefined;
      }

      const rules = await scheduling.getRules(organizationId);
      if (rules.calendarMode === "google") {
        // A confirmation needs the calendar event. Do not read out times that
        // cannot be confirmed; the call becomes a request straight away.
        const connection = await scheduling.connectionStatus(organizationId);
        if (connection.status !== "connected") {
          return { ok: false, reason: "not_bookable" };
        }
      }
      const { slots } = await scheduling.availability({
        organizationId,
        serviceId: service?.id,
        serviceAddress: input.serviceAddress,
        from: input.from.toISOString(),
        until: input.until?.toISOString(),
      });
      return {
        ok: true,
        timezone: rules.timezone,
        service: {
          id: service?.id,
          name: service?.name ?? GENERIC_SERVICE_NAME[input.language],
        },
        slots: slots.map(toOpen),
      };
    },

    async reserve(input) {
      const organizationId = await deps.findOrganizationId(input.config);
      if (!organizationId) return { status: "error" };
      const scheduling = await deps.scheduling();
      try {
        const result = await scheduling.book({
          deadlineAt: Date.now() + 6_000,
          organizationId,
          serviceId: input.serviceId,
          serviceName: input.serviceName,
          startAt: input.startAt,
          customerName: input.callerName,
          customerPhoneE164: input.callbackE164,
          serviceAddress: input.serviceAddress,
          source: "ai_receptionist",
          idempotencyKey: input.idempotencyKey,
          // The caller is offered another time on the line, so a time that was
          // just taken must not leave a pending request behind.
          requestIfUnavailable: false,
        });

        if (result.confirmed && result.appointment) {
          return {
            status: "confirmed",
            appointmentId: result.appointment.id,
            startAt: result.appointment.startAt,
          };
        }
        if (result.reason === "conflict" || result.reason === "unavailable") {
          return {
            status: "conflict",
            alternatives: result.alternatives.map(toOpen),
          };
        }
        return { status: "request", reason: result.reason ?? "not_confirmed" };
      } catch (err) {
        console.error("[receptionist] reserve failed", err);
        return { status: "error" };
      }
    },
  };
}
