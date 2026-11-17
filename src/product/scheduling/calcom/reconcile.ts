import type { SchedulingService } from "../service";
import type { SchedulingStore } from "../store";
import type { CalcomCalendarPort } from "./adapter";
import { calcomEventId, calcomUidFrom } from "./types";

/** A booking request younger than this is still allowed to report back. */
const OPEN_ROW_GRACE_MS = 60_000;
const LOOK_BEHIND_MS = 24 * 60 * 60_000;
const DEFAULT_LOOK_AHEAD_DAYS = 90;
const DEFAULT_PER_ORG_LIMIT = 50;

export type CalcomReconcileDeps = {
  store: SchedulingStore;
  scheduling: Pick<SchedulingService, "applyProviderChange">;
  /** The provider for a business, or null when it cannot be used right now. */
  portFor(organizationId: string): Promise<CalcomCalendarPort | null>;
  /** Does Cal.com still accept this business's key? */
  checkKey(
    organizationId: string,
  ): Promise<"ok" | "unauthorized" | "unreachable">;
  /** The key was refused: tell the owner the calendar needs attention. */
  onKeyRejected?(organizationId: string): Promise<void>;
  now?: () => Date;
  lookAheadDays?: number;
  perOrgLimit?: number;
};

export type CalcomReconcileTotals = {
  organizations: number;
  skipped: number;
  /** Booking requests whose outcome was found out. */
  settled: number;
  /** Bookings Cal.com held that nobody confirmed; cancelled. */
  orphansCanceled: number;
  /** Appointments cancelled in Cal.com; TradeCatch followed. */
  canceledLocally: number;
  /** Appointments moved in Cal.com; TradeCatch followed. */
  moved: number;
  /** Appointments Cal.com has no record of. Reported, never auto-cancelled. */
  missing: number;
  /** Bookings awaiting something only the contractor can do. */
  needsAttention: number;
  errors: number;
};

const emptyTotals = (): CalcomReconcileTotals => ({
  organizations: 0,
  skipped: 0,
  settled: 0,
  orphansCanceled: 0,
  canceledLocally: 0,
  moved: 0,
  missing: 0,
  needsAttention: 0,
  errors: 0,
});

/** Errors after which the Cal.com booking is one nobody confirmed. */
const CANCEL_AGAIN = new Set([
  "orphan_cancel_failed",
  "requires_confirmation",
  "start_mismatch",
]);

async function settleOpenRows(
  deps: CalcomReconcileDeps,
  port: CalcomCalendarPort,
  organizationId: string,
  totals: CalcomReconcileTotals,
  now: Date,
) {
  const rows = await deps.store.listCalcomBookings(
    organizationId,
    ["creating", "unresolved"],
    deps.perOrgLimit ?? DEFAULT_PER_ORG_LIMIT,
  );
  for (const row of rows) {
    try {
      if (row.state === "creating") {
        if (now.getTime() - Date.parse(row.createdAt) < OPEN_ROW_GRACE_MS) {
          continue;
        }
        const local = await deps.store.getAppointment(
          organizationId,
          row.appointmentId,
        );
        // If the appointment was confirmed locally, the booking is the real
        // one and only the ledger lagged behind.
        const result = await port.settle(row, {
          adopt: local?.status === "confirmed",
        });
        if (result.state === "confirmed") {
          totals.settled += 1;
          if (local?.status === "confirmed") {
            await deps.scheduling.applyProviderChange(
              organizationId,
              local.id,
              {
                kind: "moved",
                startAt: local.startAt,
                eventId: calcomEventId(result.uid),
              },
            );
          }
        } else if (result.state === "gone") {
          totals.settled += 1;
          const after = await deps.store.getCalcomBooking(
            organizationId,
            row.appointmentId,
          );
          if (after?.state === "orphan_canceled") totals.orphansCanceled += 1;
        }
        continue;
      }
      // unresolved
      if (!row.providerUid) continue;
      if (row.errorCode && CANCEL_AGAIN.has(row.errorCode)) {
        const removed = await port.cancelByUid(
          row.providerUid,
          "TradeCatch: booking was never confirmed",
        );
        if (removed) {
          await deps.store.saveCalcomBooking({
            ...row,
            state: "orphan_canceled",
            errorCode: undefined,
            updatedAt: now.toISOString(),
          });
          totals.orphansCanceled += 1;
        } else {
          totals.errors += 1;
        }
      } else {
        // A move that Cal.com is holding for the contractor's approval.
        totals.needsAttention += 1;
      }
    } catch {
      totals.errors += 1;
    }
  }
}

async function followBooking(
  deps: CalcomReconcileDeps,
  port: CalcomCalendarPort,
  organizationId: string,
  appointmentId: string,
  startAt: string,
  uid: string,
  totals: CalcomReconcileTotals,
) {
  let current = uid;
  for (let hop = 0; hop < 3; hop += 1) {
    const seen = await port.inspect(current);
    if (seen.state === "unknown") {
      totals.errors += 1;
      return;
    }
    if (seen.state === "missing") {
      totals.missing += 1;
      const events = await deps.store.listEvents(organizationId, appointmentId);
      if (events[events.length - 1]?.kind !== "provider_missing") {
        await deps.store.addEvent({
          organizationId,
          appointmentId,
          kind: "provider_missing",
          at: new Date().toISOString(),
        });
      }
      return;
    }
    const booking = seen.booking;
    if (booking.status === "accepted") {
      const moved = Date.parse(booking.startAt) !== Date.parse(startAt);
      const relinked = current !== uid;
      if (moved || relinked) {
        const result = await deps.scheduling.applyProviderChange(
          organizationId,
          appointmentId,
          {
            kind: "moved",
            startAt: booking.startAt,
            eventId: calcomEventId(booking.uid),
          },
        );
        if (result.applied) totals.moved += 1;
        const row = await deps.store.findCalcomBookingByUid(organizationId, uid);
        if (row) {
          await deps.store.saveCalcomBooking({
            ...row,
            providerUid: booking.uid,
            startAt: booking.startAt,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      return;
    }
    if (booking.status === "cancelled" && booking.rescheduledToUid) {
      current = booking.rescheduledToUid;
      continue;
    }
    if (booking.status === "cancelled" || booking.status === "rejected") {
      const result = await deps.scheduling.applyProviderChange(
        organizationId,
        appointmentId,
        { kind: "canceled" },
      );
      if (result.applied) totals.canceledLocally += 1;
      const row = await deps.store.findCalcomBookingByUid(organizationId, uid);
      if (row) {
        await deps.store.saveCalcomBooking({
          ...row,
          state: "canceled",
          updatedAt: new Date().toISOString(),
        });
      }
      return;
    }
    // pending, awaiting_host, unknown status: only the contractor can act.
    totals.needsAttention += 1;
    return;
  }
}

async function followConfirmed(
  deps: CalcomReconcileDeps,
  port: CalcomCalendarPort,
  organizationId: string,
  totals: CalcomReconcileTotals,
  now: Date,
) {
  const horizon =
    now.getTime() + (deps.lookAheadDays ?? DEFAULT_LOOK_AHEAD_DAYS) * 86_400_000;
  const rows = (await deps.store.listAppointments(organizationId))
    .filter(
      (row) =>
        row.status === "confirmed" &&
        !row.simulated &&
        calcomUidFrom(row.calendarEventId) !== null &&
        Date.parse(row.endAt) >= now.getTime() - LOOK_BEHIND_MS &&
        Date.parse(row.startAt) <= horizon,
    )
    .slice(0, deps.perOrgLimit ?? DEFAULT_PER_ORG_LIMIT);
  for (const row of rows) {
    const uid = calcomUidFrom(row.calendarEventId);
    if (!uid) continue;
    try {
      await followBooking(
        deps,
        port,
        organizationId,
        row.id,
        row.startAt,
        uid,
        totals,
      );
    } catch {
      totals.errors += 1;
    }
  }
}

/** Bring TradeCatch and one business's Cal.com account back into agreement. */
export async function reconcileCalcomOrganization(
  deps: CalcomReconcileDeps,
  organizationId: string,
  totals: CalcomReconcileTotals = emptyTotals(),
): Promise<CalcomReconcileTotals> {
  const now = (deps.now ?? (() => new Date()))();
  totals.organizations += 1;
  const connection = await deps.store.getCalcomConnection(organizationId);
  if (!connection || connection.status === "disconnected") {
    totals.skipped += 1;
    return totals;
  }
  const health = await deps.checkKey(organizationId);
  if (health === "unauthorized") {
    if (connection.status !== "error") {
      await deps.store.saveCalcomConnection({
        ...connection,
        status: "error",
        lastError: "unauthorized",
        updatedAt: now.toISOString(),
      });
      await deps.onKeyRejected?.(organizationId);
    }
    totals.skipped += 1;
    return totals;
  }
  if (health === "unreachable") {
    // Do not guess while Cal.com cannot be asked.
    totals.skipped += 1;
    totals.errors += 1;
    return totals;
  }
  if (connection.status === "error") {
    await deps.store.saveCalcomConnection({
      ...connection,
      status: "connected",
      lastError: undefined,
      lastVerifiedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }
  const port = await deps.portFor(organizationId);
  if (!port) {
    totals.skipped += 1;
    return totals;
  }
  await settleOpenRows(deps, port, organizationId, totals, now);
  await followConfirmed(deps, port, organizationId, totals, now);
  return totals;
}

/** One pass over every business that has Cal.com connected. */
export async function reconcileCalcom(
  deps: CalcomReconcileDeps,
): Promise<CalcomReconcileTotals> {
  const totals = emptyTotals();
  const connections = await deps.store.listCalcomConnections();
  for (const connection of connections) {
    try {
      await reconcileCalcomOrganization(deps, connection.organizationId, totals);
    } catch {
      totals.errors += 1;
    }
  }
  return totals;
}
