import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { openTokens } from "../google";
import { overlaps } from "../slots";
import type { SchedulingStore, StoredConnection } from "../store";
import type { ScheduleAppointment } from "../types";
import {
  createGoogleClient,
  describeFailure,
  type CallFailure,
  type GoogleClient,
  type GoogleUrls,
} from "./client";
import {
  buildEventBody,
  busyBlocks,
  eventIdFor,
  EVENT_LIST_FIELDS,
  parseGoogleEvent,
} from "./events";
import type { OpenGoogleFn } from "./open";
import type {
  EventLink,
  EventLinkOp,
  ExternalEvent,
  GoogleErrorKind,
  SyncState,
  SyncSummary,
} from "./types";

// ---------------------------------------------------------------------------
// Tuning. Every limit is a bound: nothing retries, waits or grows forever.
// ---------------------------------------------------------------------------

/** After this many failed sends a change is marked failed and shown to the owner. */
export const MAX_ATTEMPTS = 10;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_CAP_MS = 60 * 60_000;
/** How long a worker that claimed a change owns it before another may take over. */
const CLAIM_LEASE_MS = 90_000;
const PULL_LEASE_MS = 120_000;
/** A pull that ran while another was in progress goes round at most this often. */
const MAX_PULL_LOOPS = 3;
/** The whole window is re-read this often, so nothing drifts and the window rolls forward. */
export const FULL_RESYNC_MS = 24 * 60 * 60_000;
/** A mirror older than this is no longer trusted to say a time is free. */
export const MAX_STALE_MS = 30 * 60_000;
/** The safety-net pull when push notifications are working / not working. */
const PULL_EVERY_PUSH_MS = 15 * 60_000;
const PULL_EVERY_POLL_MS = 3 * 60_000;
const CHANNEL_TTL_SECONDS = 7 * 24 * 60 * 60;
const RENEW_CHANNEL_BEFORE_MS = 24 * 60 * 60_000;
const PAST_WINDOW_MS = 24 * 60 * 60_000;
const WINDOW_EXTRA_DAYS = 30;

export function backoffMs(
  attempts: number,
  random: () => number = Math.random,
  retryAfterMs?: number,
): number {
  const exponential = Math.min(
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    BACKOFF_CAP_MS,
  );
  // ±20%, so a business-wide outage does not make every retry land together.
  const jittered = exponential * (0.8 + random() * 0.4);
  return Math.max(Math.round(jittered), retryAfterMs ?? 0);
}

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function sameInstant(a: string | undefined, b: string | undefined) {
  return Boolean(a && b && Date.parse(a) === Date.parse(b));
}

// ---------------------------------------------------------------------------

export type GcalSyncDeps = {
  store: SchedulingStore;
  open: OpenGoogleFn;
  /** Plan and operator enrollment. Checked on every entry point, never cached. */
  allowed: (organizationId: string) => Promise<boolean>;
  rules: (
    organizationId: string,
  ) => Promise<{ timezone: string; maxAdvanceDays: number } | null>;
  now?: () => Date;
  random?: () => number;
  /** The public https address Google pushes to. Unset: poll only. */
  webhookUrl?: () => string | undefined;
  /** The owner has to reconnect: tell them. Called at most once per revocation. */
  onRevoked?: (organizationId: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  urls?: GoogleUrls;
};

export type PullOutcome =
  | { status: "ok"; full: boolean; events: number }
  | { status: "skipped"; reason: string }
  | { status: "busy" }
  | { status: "failed"; kind: GoogleErrorKind; error: string };

export type PushOutcome = {
  claimed: number;
  synced: number;
  retrying: number;
  failed: number;
};

export type PushNotification = {
  channelId: string;
  token: string;
  resourceState?: string;
  messageNumber?: number;
};

export function createGoogleSync(deps: GcalSyncDeps) {
  const { store } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const random = deps.random ?? Math.random;
  const iso = () => now().toISOString();

  /**
   * Saves part of the sync state on top of the latest stored copy, so a pull
   * finishing never erases a push channel created while it was running (or the
   * reverse).
   */
  async function updateState(
    organizationId: string,
    base: SyncState,
    patch: Partial<SyncState>,
  ) {
    const latest = (await store.getSyncState(organizationId)) ?? base;
    await store.saveSyncState({ ...latest, ...patch, organizationId });
  }

  // -------------------------------------------------------------------------
  // The link between an appointment and its Google event
  // -------------------------------------------------------------------------

  /**
   * Records that an appointment's Google event has to be created, brought up to
   * date, or removed. It never talks to Google: the change is durable the
   * moment this returns, and `push` makes it true. The event id is derived from
   * the appointment, so asking twice (a retry, a double click, a lost answer)
   * can never produce two events.
   */
  async function enqueue(
    organizationId: string,
    appointment: Pick<ScheduleAppointment, "id" | "calendarEventId" | "simulated">,
    op: EventLinkOp,
  ): Promise<EventLink | null> {
    if (appointment.simulated) return null;
    const connection = await store.getConnection(organizationId);
    const calendarId = connection?.calendarId;
    if (!calendarId) return null;
    const existing = await store.getEventLink(organizationId, appointment.id);
    const stamp = iso();

    if (existing && existing.state !== "detached" && existing.calendarId === calendarId) {
      // The owner removed our event. A later reschedule must not bring it back
      // behind their back, and there is nothing left to delete.
      if (existing.state === "external_deleted") {
        if (op !== "delete") return existing;
        const closed: EventLink = { ...existing, state: "synced", pendingOp: null, updatedAt: stamp };
        await store.saveEventLink(closed);
        return closed;
      }
      // An event that has never been written successfully is still a create.
      const neverWritten = existing.pendingOp === "create" || !existing.lastSyncedAt;
      const link: EventLink = {
        ...existing,
        state: "pending",
        pendingOp: op === "delete" ? "delete" : neverWritten || !existing.eventId ? "create" : "update",
        attempts: 0,
        nextAttemptAt: stamp,
        lastError: undefined,
        updatedAt: stamp,
      };
      await store.saveEventLink(link);
      return link;
    }

    // A first link, a re-attach after a disconnect, or a different calendar.
    if (op === "delete" && !appointment.calendarEventId && !existing?.eventId) return null;
    const generation = existing?.generation ?? 1;
    const legacyId =
      !existing && appointment.calendarEventId && op !== "create"
        ? appointment.calendarEventId
        : undefined;
    const link: EventLink = {
      organizationId,
      appointmentId: appointment.id,
      calendarId,
      eventId: existing?.eventId ?? legacyId ?? eventIdFor(organizationId, appointment.id, generation),
      generation,
      state: "pending",
      pendingOp: op === "delete" ? "delete" : legacyId ? "update" : "create",
      attempts: 0,
      nextAttemptAt: stamp,
      updatedAt: stamp,
    };
    await store.saveEventLink(link);
    return link;
  }

  /**
   * Gives every confirmed future appointment a Google event when a calendar is
   * connected (or changed), and recognises the events earlier versions wrote so
   * they are not mistaken for the owner's own busy time.
   */
  async function backfill(organizationId: string): Promise<number> {
    const connection = await store.getConnection(organizationId);
    if (!connection?.calendarId) return 0;
    const stamp = iso();
    let queued = 0;
    const appointments = await store.listAppointments(organizationId);
    for (const appointment of appointments) {
      if (
        appointment.status !== "confirmed" ||
        appointment.simulated ||
        Date.parse(appointment.endAt) <= now().getTime()
      )
        continue;
      const existing = await store.getEventLink(organizationId, appointment.id);
      if (existing && existing.state !== "detached" && existing.calendarId === connection.calendarId)
        continue;
      const id = appointment.calendarEventId;
      const googleWrittenBefore =
        id && !id.startsWith("simcal_") && !id.startsWith("calcom_") && !existing;
      if (googleWrittenBefore) {
        await store.saveEventLink({
          organizationId,
          appointmentId: appointment.id,
          calendarId: connection.calendarId,
          eventId: id!,
          generation: 1,
          state: "synced",
          pendingOp: null,
          attempts: 0,
          syncedStartAt: appointment.startAt,
          syncedEndAt: appointment.endAt,
          lastSyncedAt: stamp,
          updatedAt: stamp,
        });
        continue;
      }
      await enqueue(organizationId, appointment, "create");
      queued += 1;
    }
    return queued;
  }

  // -------------------------------------------------------------------------
  // Push: TradeCatch -> Google
  // -------------------------------------------------------------------------

  async function sendLink(
    client: GoogleClient,
    connection: StoredConnection,
    calendarId: string,
    link: EventLink,
    given?: ScheduleAppointment,
  ): Promise<EventLink> {
    const organizationId = link.organizationId;
    // The booking flow asks for the event BEFORE it saves the appointment (a
    // hold, an old time, a not-yet-canceled row), so it hands over the
    // appointment as it will be. A later retry reads the saved one.
    const appointment =
      given ?? (await store.getAppointment(organizationId, link.appointmentId));
    const stamp = iso();
    const settled = (patch: Partial<EventLink>): EventLink => ({
      ...link,
      state: "synced",
      pendingOp: null,
      attempts: 0,
      nextAttemptAt: undefined,
      lastError: undefined,
      lastSyncedAt: stamp,
      updatedAt: stamp,
      ...patch,
    });
    const failed = (failure: CallFailure): EventLink =>
      failLink(link, failure, stamp);

    // Test bookings never reach a real calendar.
    if (appointment?.simulated) return settled({});

    const detail = connection.eventDetail ?? "minimal";
    const policy = connection.cancelPolicy ?? "remove";
    const eventId = link.eventId ?? eventIdFor(organizationId, link.appointmentId, link.generation);

    const removing =
      link.pendingOp === "delete" ||
      appointment?.status === "canceled" ||
      !appointment;

    if (!removing && appointment?.status === "confirmed") {
      const body = buildEventBody(appointment, { detail });
      const written = {
        syncedStartAt: appointment.startAt,
        syncedEndAt: appointment.endAt,
        externalStartAt: undefined,
        externalEndAt: undefined,
      };
      if (link.pendingOp === "create") {
        const inserted = await client.insertEvent(calendarId, { id: eventId, ...body });
        if (inserted.ok) {
          return settled({ eventId, remoteEtag: str(inserted.event.etag), ...written });
        }
        if (inserted.kind !== "conflict") return failed(inserted);
        // 409: an event with this id exists. Either an earlier attempt whose
        // answer we lost (adopt it), or one that was deleted (ids are never reused).
        const existing = await client.getEvent(calendarId, eventId);
        if (!existing.ok) return failed(existing);
        if (existing.event.status === "cancelled") {
          return {
            ...link,
            generation: link.generation + 1,
            eventId: eventIdFor(organizationId, link.appointmentId, link.generation + 1),
            nextAttemptAt: stamp,
            updatedAt: stamp,
          };
        }
      }
      const patched = await client.patchEvent(calendarId, eventId, body);
      if (patched.ok) {
        return settled({ eventId, remoteEtag: str(patched.event.etag), ...written });
      }
      if (patched.kind === "not_found" || patched.kind === "gone") {
        // The owner deleted our event. The appointment stays; nothing is recreated.
        return settled({ eventId, state: "external_deleted" });
      }
      return failed(patched);
    }

    if (removing) {
      if (policy === "mark_canceled" && appointment) {
        const body = buildEventBody(appointment, { detail, canceled: true });
        const patched = await client.patchEvent(calendarId, eventId, body);
        if (patched.ok) return settled({ eventId, remoteEtag: str(patched.event.etag) });
        if (patched.kind === "not_found" || patched.kind === "gone") return settled({ eventId });
        return failed(patched);
      }
      const removed = await client.deleteEvent(calendarId, eventId);
      if (removed.ok || removed.kind === "not_found" || removed.kind === "gone") {
        return settled({ eventId });
      }
      return failed(removed);
    }

    // A completed appointment keeps its event as it was; a hold or request never had one.
    return settled({});
  }

  function failLink(link: EventLink, failure: CallFailure, stamp: string): EventLink {
    const lastError = describeFailure(failure);
    if (failure.kind === "auth_revoked" || failure.kind === "auth") {
      // Not this change's fault and not worth an attempt: it waits for the owner
      // to reconnect and then goes out at once.
      return { ...link, lastError, nextAttemptAt: stamp, updatedAt: stamp };
    }
    if (
      failure.kind === "permanent" ||
      failure.kind === "not_found" ||
      failure.kind === "gone"
    ) {
      return { ...link, state: "failed", lastError, nextAttemptAt: undefined, updatedAt: stamp };
    }
    const attempts = link.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      return {
        ...link,
        state: "failed",
        attempts,
        lastError,
        nextAttemptAt: undefined,
        updatedAt: stamp,
      };
    }
    return {
      ...link,
      state: "pending",
      attempts,
      lastError,
      nextAttemptAt: new Date(
        now().getTime() + backoffMs(attempts, random, failure.retryAfterMs),
      ).toISOString(),
      updatedAt: stamp,
    };
  }

  /**
   * Sends what is waiting. A change is claimed first (so two Workers never send
   * it twice at once) and the result is saved against a fresh read: if the
   * appointment changed again while the request was in flight, that newer change
   * stays queued instead of being overwritten by this one's success.
   */
  async function push(options: {
    organizationId?: string;
    appointmentId?: string;
    limit?: number;
    timeoutMs?: number;
    /** The appointment as the caller is about to save it (see sendLink). */
    appointment?: ScheduleAppointment;
  } = {}): Promise<PushOutcome> {
    const outcome: PushOutcome = { claimed: 0, synced: 0, retrying: 0, failed: 0 };
    const claimed = await store.claimEventLinks({
      organizationId: options.organizationId,
      appointmentId: options.appointmentId,
      now: now(),
      limit: options.limit ?? 50,
      leaseMs: CLAIM_LEASE_MS,
    });
    outcome.claimed = claimed.length;
    const byOrganization = new Map<string, EventLink[]>();
    for (const link of claimed) {
      byOrganization.set(link.organizationId, [
        ...(byOrganization.get(link.organizationId) ?? []),
        link,
      ]);
    }
    for (const [organizationId, links] of byOrganization) {
      const opened = await deps.open(organizationId, { timeoutMs: options.timeoutMs });
      if (!opened.ok) continue;
      for (const link of links) {
        // A link for a calendar that is no longer the selected one is not ours to send.
        if (link.calendarId !== opened.calendarId) continue;
        let result: EventLink;
        try {
          result = await sendLink(
            opened.client,
            opened.connection,
            opened.calendarId,
            link,
            options.appointment?.id === link.appointmentId ? options.appointment : undefined,
          );
        } catch {
          result = failLink(link, { ok: false, kind: "transient", status: 0 }, iso());
        }
        const fresh = await store.getEventLink(organizationId, link.appointmentId);
        if (fresh && fresh.updatedAt !== link.updatedAt) {
          // Changed while we were sending: keep what the send learned about the
          // event, and leave the newer change queued.
          result = {
            ...fresh,
            eventId: result.eventId ?? fresh.eventId,
            generation: result.generation,
            remoteEtag: result.remoteEtag ?? fresh.remoteEtag,
            state: "pending",
            pendingOp: fresh.pendingOp ?? "update",
            nextAttemptAt: iso(),
            updatedAt: iso(),
          };
        }
        await store.saveEventLink(result);
        if (result.state === "synced") outcome.synced += 1;
        else if (result.state === "failed") outcome.failed += 1;
        else outcome.retrying += 1;
        if (result.lastError === "google_access_revoked") await markRevoked(organizationId);
      }
    }
    return outcome;
  }

  // -------------------------------------------------------------------------
  // Pull: Google -> TradeCatch
  // -------------------------------------------------------------------------

  async function markRevoked(organizationId: string) {
    const connection = await store.getConnection(organizationId);
    // Never overwrite a disconnect that happened while a call was in flight.
    if (!connection || connection.status !== "connected") return;
    await store.saveConnection({
      ...connection,
      status: "expired",
      lastError: "google_access_revoked",
    });
    await deps.onRevoked?.(organizationId).catch(() => undefined);
  }

  function classifyOwn(
    link: EventLink,
    event: ExternalEvent,
    appointment: ScheduleAppointment | null,
  ): EventLink | null {
    // Our own write coming back as a change notification.
    if (event.etag && event.etag === link.remoteEtag) return null;
    const agrees =
      (sameInstant(event.startAt, link.syncedStartAt) && sameInstant(event.endAt, link.syncedEndAt)) ||
      (appointment &&
        sameInstant(event.startAt, appointment.startAt) &&
        sameInstant(event.endAt, appointment.endAt));
    if (agrees) {
      // A change to the title, notes or colour (or the owner moving it back):
      // nothing for TradeCatch to do, and nothing is written back.
      return {
        ...link,
        remoteEtag: event.etag,
        state: link.state === "external_modified" ? "synced" : link.state,
        externalStartAt: undefined,
        externalEndAt: undefined,
        updatedAt: iso(),
      };
    }
    // A change TradeCatch is about to send itself wins over the stale remote copy.
    if (link.pendingOp) return null;
    return {
      ...link,
      state: "external_modified",
      remoteEtag: event.etag,
      externalStartAt: event.startAt,
      externalEndAt: event.endAt,
      updatedAt: iso(),
    };
  }

  function classifyOwnDeleted(
    link: EventLink,
    appointment: ScheduleAppointment | null,
  ): EventLink | null {
    if (link.state === "external_deleted" || link.state === "detached") return null;
    const expected =
      link.pendingOp === "delete" ||
      !appointment ||
      appointment.status === "canceled" ||
      appointment.status === "completed";
    if (expected) {
      return link.state === "synced" && !link.pendingOp
        ? null
        : { ...link, state: "synced", pendingOp: null, attempts: 0, nextAttemptAt: undefined, updatedAt: iso() };
    }
    return {
      ...link,
      state: "external_deleted",
      pendingOp: null,
      attempts: 0,
      nextAttemptAt: undefined,
      lastError: undefined,
      externalStartAt: undefined,
      externalEndAt: undefined,
      updatedAt: iso(),
    };
  }

  async function pullOnce(organizationId: string, forceFull: boolean): Promise<PullOutcome> {
    const opened = await deps.open(organizationId);
    if (!opened.ok) {
      if (opened.reason === "revoked") await markRevoked(organizationId);
      return { status: "skipped", reason: opened.reason };
    }
    const { client, calendarId } = opened;
    const rules = await deps.rules(organizationId);
    const timeZone = rules?.timezone ?? "America/Toronto";
    const maxAdvanceDays = rules?.maxAdvanceDays ?? 60;
    const started = now();

    let state: SyncState = (await store.getSyncState(organizationId)) ?? {
      organizationId,
      consecutiveFailures: 0,
    };
    if (state.calendarId !== calendarId) {
      // A different calendar: nothing mirrored from the old one applies.
      state = { organizationId, calendarId, consecutiveFailures: 0 };
      await store.replaceMirror(organizationId, calendarId, []);
      await store.saveSyncState({ ...state });
    }
    const full =
      forceFull ||
      !state.syncToken ||
      !state.lastFullSyncAt ||
      started.getTime() - Date.parse(state.lastFullSyncAt) > FULL_RESYNC_MS;

    const timeMin = new Date(started.getTime() - PAST_WINDOW_MS).toISOString();
    const timeMax = new Date(
      started.getTime() + (maxAdvanceDays + WINDOW_EXTRA_DAYS) * 24 * 60 * 60_000,
    ).toISOString();

    const collect = async (useToken: boolean) => {
      const upserts: ExternalEvent[] = [];
      const deleted: string[] = [];
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;
      for (let pages = 0; pages < 40; pages++) {
        const result = await client.listEvents({
          calendarId,
          syncToken: useToken ? state.syncToken : undefined,
          pageToken,
          timeMin,
          timeMax,
          fields: EVENT_LIST_FIELDS,
        });
        if (!result.ok) return result;
        for (const raw of result.page.items) {
          const parsed = parseGoogleEvent(raw as never, timeZone);
          if (!parsed) continue;
          if (parsed.kind === "deleted") deleted.push(parsed.eventId);
          else upserts.push(parsed.event);
        }
        pageToken = result.page.nextPageToken;
        nextSyncToken = result.page.nextSyncToken ?? nextSyncToken;
        if (!pageToken) break;
      }
      return { ok: true as const, upserts, deleted, nextSyncToken, complete: !pageToken };
    };

    let useToken = !full;
    let collected = await collect(useToken);
    if (!collected.ok && collected.kind === "gone" && useToken) {
      // Google no longer honours the sync token: start over from a full read.
      useToken = false;
      state = { ...state, syncToken: undefined };
      collected = await collect(false);
    }
    if (!collected.ok) return recordFailure(organizationId, state, collected);
    if (!collected.complete || !collected.nextSyncToken) {
      return recordFailure(organizationId, state, { ok: false, kind: "transient", status: 0 });
    }

    const links = await store.listEventLinks(organizationId);
    const linkByEvent = new Map(
      links
        .filter((link) => link.eventId && link.calendarId === calendarId && link.state !== "detached")
        .map((link) => [link.eventId as string, link]),
    );
    const changed = new Map<string, EventLink>();
    const track = (link: EventLink) => changed.set(link.appointmentId, link);

    for (const event of collected.upserts) {
      const link = linkByEvent.get(event.eventId);
      if (!link) continue;
      const appointment = await store.getAppointment(organizationId, link.appointmentId);
      const next = classifyOwn(changed.get(link.appointmentId) ?? link, event, appointment);
      if (next) track(next);
    }
    for (const eventId of collected.deleted) {
      const link = linkByEvent.get(eventId);
      if (!link) continue;
      const appointment = await store.getAppointment(organizationId, link.appointmentId);
      const next = classifyOwnDeleted(changed.get(link.appointmentId) ?? link, appointment);
      if (next) track(next);
    }
    if (!useToken) {
      // A full read is the whole truth for its window: an event of ours that
      // lies inside it and is not there any more was deleted by the owner.
      const seen = new Set([...collected.upserts.map((event) => event.eventId), ...collected.deleted]);
      for (const link of linkByEvent.values()) {
        if (seen.has(link.eventId as string) || link.pendingOp) continue;
        if (!link.syncedStartAt || !link.syncedEndAt) continue;
        if (Date.parse(link.syncedStartAt) < Date.parse(timeMin) || Date.parse(link.syncedEndAt) > Date.parse(timeMax)) continue;
        if (link.state !== "synced" && link.state !== "external_modified") continue;
        const appointment = await store.getAppointment(organizationId, link.appointmentId);
        const next = classifyOwnDeleted(changed.get(link.appointmentId) ?? link, appointment);
        if (next) track(next);
      }
    }

    if (useToken) await store.applyMirror(organizationId, calendarId, collected.upserts, collected.deleted);
    else await store.replaceMirror(organizationId, calendarId, collected.upserts);
    for (const link of changed.values()) await store.saveEventLink(link);

    const mirror = await store.listMirror(organizationId, calendarId);
    const allLinks = links.map((link) => changed.get(link.appointmentId) ?? link);
    const horizon = started.getTime() - PAST_WINDOW_MS;
    await store.replaceBusy(
      organizationId,
      busyBlocks(mirror, allLinks).filter((block) => Date.parse(block.endAt) > horizon),
    );

    const stamp = iso();
    await updateState(organizationId, state, {
      calendarId,
      syncToken: collected.nextSyncToken,
      lastSyncedAt: stamp,
      lastFullSyncAt: useToken ? state.lastFullSyncAt : stamp,
      lastError: undefined,
      consecutiveFailures: 0,
      nextAttemptAt: undefined,
    });
    // A good read clears a transient "error" the owner may have been shown.
    const connection = await store.getConnection(organizationId);
    if (connection && connection.status === "error" && connection.lastError !== "select_calendar") {
      await store.saveConnection({ ...connection, status: "connected", lastError: undefined });
    }
    return { status: "ok", full: !useToken, events: collected.upserts.length };
  }

  async function recordFailure(
    organizationId: string,
    state: SyncState,
    failure: CallFailure,
  ): Promise<PullOutcome> {
    if (failure.kind === "auth_revoked" || failure.kind === "auth") {
      await markRevoked(organizationId);
    }
    const failures = state.consecutiveFailures + 1;
    const error = describeFailure(failure);
    await updateState(organizationId, state, {
      lastError: error,
      consecutiveFailures: failures,
      nextAttemptAt: new Date(
        now().getTime() + backoffMs(failures, random, failure.retryAfterMs),
      ).toISOString(),
    });
    return { status: "failed", kind: failure.kind, error };
  }

  /**
   * Reads what changed in the owner's calendar. One pull at a time per business
   * (a notification that arrives meanwhile makes the holder read once more).
   * Never throws: a Google outage is recorded and the next tick tries again.
   */
  async function pull(
    organizationId: string,
    options: { full?: boolean } = {},
  ): Promise<PullOutcome> {
    if (!(await deps.allowed(organizationId))) return { status: "skipped", reason: "not_allowed" };
    const acquired = await store.tryLease(
      organizationId,
      now(),
      new Date(now().getTime() + PULL_LEASE_MS),
    );
    if (!acquired) {
      await store.requestRerun(organizationId);
      return { status: "busy" };
    }
    let outcome: PullOutcome = { status: "skipped", reason: "not_connected" };
    try {
      let force = Boolean(options.full);
      for (let loop = 0; loop < MAX_PULL_LOOPS; loop++) {
        try {
          outcome = await pullOnce(organizationId, force);
        } catch {
          outcome = { status: "failed", kind: "transient", error: "google_unavailable" };
        }
        force = false;
        if (!(await store.consumeRerun(organizationId))) break;
      }
    } finally {
      await store.releaseLease(organizationId);
    }
    return outcome;
  }

  /**
   * Used right before a time is confirmed: brings the mirror up to date with a
   * short, bounded read, and says whether the mirror is fresh enough to trust.
   * A Google outage does not stop a booking while the mirror is recent, but a
   * business whose calendar has never been read, or not read for a long time,
   * is never told a time is free.
   */
  async function prepare(
    organizationId: string,
    options: { budgetMs?: number } = {},
  ): Promise<{ ok: boolean; stale: boolean }> {
    const budget = options.budgetMs ?? 2500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      pull(organizationId).catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, budget);
      }),
    ]);
    clearTimeout(timer);
    const state = await store.getSyncState(organizationId);
    if (!state?.syncToken || !state.lastSyncedAt) return { ok: false, stale: true };
    const stale = now().getTime() - Date.parse(state.lastSyncedAt) > MAX_STALE_MS;
    return { ok: !stale, stale };
  }

  // -------------------------------------------------------------------------
  // Push notifications (watch channels)
  // -------------------------------------------------------------------------

  async function ensureChannel(
    organizationId: string,
    options: { force?: boolean } = {},
  ): Promise<"active" | "unavailable"> {
    const address = deps.webhookUrl?.();
    if (!address) return "unavailable";
    const opened = await deps.open(organizationId);
    if (!opened.ok) return "unavailable";
    const state = await store.getSyncState(organizationId);
    if (!state || state.calendarId !== opened.calendarId) return "unavailable";
    const expiresAt = state.channelExpiresAt ? Date.parse(state.channelExpiresAt) : 0;
    if (
      !options.force &&
      state.channelId &&
      expiresAt - now().getTime() > RENEW_CHANNEL_BEFORE_MS
    ) {
      return "active";
    }
    const channelId = randomBytes(24).toString("base64url");
    const token = randomBytes(32).toString("base64url");
    const result = await opened.client.watch(opened.calendarId, {
      id: channelId,
      token,
      address,
      ttlSeconds: CHANNEL_TTL_SECONDS,
    });
    if (!result.ok) return "unavailable";
    // The new channel is recorded before the old one is stopped, so there is
    // never a moment with no channel, and a duplicate notification during the
    // overlap is harmless (a pull is idempotent).
    const previous = { id: state.channelId, resourceId: state.resourceId };
    await updateState(organizationId, state, {
      channelId,
      channelTokenHash: hashToken(token),
      resourceId: result.resourceId,
      channelExpiresAt: result.expiresAt,
      lastMessageNumber: undefined,
    });
    if (previous.id) {
      await opened.client.stopChannel({ id: previous.id, resourceId: previous.resourceId });
    }
    return "active";
  }

  /**
   * A notification from Google. The channel id and the secret token (known
   * only to us and Google, and stored hashed) identify the business: nothing
   * in the request can name another tenant. A repeated or older notification
   * is acknowledged and ignored.
   */
  async function receive(
    notification: PushNotification,
  ): Promise<{ status: "ignored" | "duplicate" | "synced" | "unauthorized" }> {
    const state = await store.findSyncStateByChannel(notification.channelId);
    const expected = state?.channelTokenHash;
    const given = hashToken(notification.token);
    const matches =
      Boolean(expected) &&
      expected!.length === given.length &&
      timingSafeEqual(Buffer.from(expected!), Buffer.from(given));
    if (!state || !matches) return { status: "unauthorized" };
    if (notification.resourceState === "sync") return { status: "ignored" };
    const number = notification.messageNumber;
    if (
      number !== undefined &&
      state.lastMessageNumber !== undefined &&
      number <= state.lastMessageNumber
    ) {
      return { status: "duplicate" };
    }
    if (number !== undefined) {
      await updateState(state.organizationId, state, { lastMessageNumber: number });
    }
    await pull(state.organizationId);
    return { status: "synced" };
  }

  // -------------------------------------------------------------------------
  // The periodic pass
  // -------------------------------------------------------------------------

  async function tick(): Promise<{
    pulled: number;
    pushed: PushOutcome;
    channels: number;
  }> {
    let pulled = 0;
    let channels = 0;
    for (const state of await store.listSyncStates()) {
      const organizationId = state.organizationId;
      try {
        const due = !state.nextAttemptAt || Date.parse(state.nextAttemptAt) <= now().getTime();
        const everyMs =
          state.channelExpiresAt && Date.parse(state.channelExpiresAt) > now().getTime()
            ? PULL_EVERY_PUSH_MS
            : PULL_EVERY_POLL_MS;
        const last = state.lastSyncedAt ? Date.parse(state.lastSyncedAt) : 0;
        if (due && (!state.syncToken || now().getTime() - last >= everyMs || state.lastError)) {
          const result = await pull(organizationId);
          if (result.status === "ok") pulled += 1;
        }
        if ((await ensureChannel(organizationId)) === "active") channels += 1;
      } catch {
        // One business's failure never stops the others.
      }
    }
    const pushed = await push({ limit: 50 }).catch(
      () => ({ claimed: 0, synced: 0, retrying: 0, failed: 0 }) as PushOutcome,
    );
    return { pulled, pushed, channels };
  }

  // -------------------------------------------------------------------------
  // Owner-facing state and actions
  // -------------------------------------------------------------------------

  async function summary(organizationId: string): Promise<SyncSummary> {
    const [state, links, appointments, busy] = await Promise.all([
      store.getSyncState(organizationId),
      store.listEventLinks(organizationId),
      store.listAppointments(organizationId),
      store.listBusy(organizationId),
    ]);
    const appointmentById = new Map(appointments.map((a) => [a.id, a]));
    const failedLink = links.find((link) => link.state === "failed");
    const nowMs = now().getTime();
    const expires = state?.channelExpiresAt ? Date.parse(state.channelExpiresAt) : 0;
    const push: SyncSummary["push"] = !state?.channelId
      ? deps.webhookUrl?.() ? "unavailable" : "off"
      : expires <= nowMs
        ? "unavailable"
        : expires - nowMs < RENEW_CHANNEL_BEFORE_MS
          ? "expiring"
          : "active";
    return {
      lastSuccessfulSyncAt: state?.lastSyncedAt,
      lastError: state?.lastError ?? failedLink?.lastError,
      pending: links.filter((link) => link.state === "pending").length,
      failed: links.filter((link) => link.state === "failed").length,
      needsAttention: links
        .filter(
          (link): link is EventLink & { state: "external_modified" | "external_deleted" } =>
            link.state === "external_modified" || link.state === "external_deleted",
        )
        .map((link) => ({
          appointmentId: link.appointmentId,
          state: link.state,
          startAt: appointmentById.get(link.appointmentId)?.startAt,
        })),
      overlaps: appointments
        .filter(
          (a) =>
            a.status === "confirmed" &&
            !a.simulated &&
            Date.parse(a.endAt) > nowMs &&
            busy.some((block) => overlaps(a.startAt, a.endAt, block.startAt, block.endAt)),
        )
        .map((a) => ({ appointmentId: a.id, startAt: a.startAt })),
      push,
    };
  }

  /**
   * How much detail Google shows (or what a cancellation does) changed: every
   * event TradeCatch wrote is rewritten, so a switch to "minimal" also removes
   * customer details from events that already exist.
   */
  async function requeueAll(organizationId: string): Promise<number> {
    const stamp = iso();
    let queued = 0;
    for (const link of await store.listEventLinks(organizationId)) {
      if (link.state !== "synced" || !link.eventId || link.pendingOp) continue;
      const appointment = await store.getAppointment(organizationId, link.appointmentId);
      if (appointment?.status !== "confirmed") continue;
      await store.saveEventLink({
        ...link,
        state: "pending",
        pendingOp: "update",
        attempts: 0,
        nextAttemptAt: stamp,
        updatedAt: stamp,
      });
      queued += 1;
    }
    return queued;
  }

  /**
   * The owner pressed "Sync now". Changes that gave up get a fresh set of
   * attempts, and changes that are only waiting out a backoff are sent now
   * instead (an explicit request outranks the schedule; they keep the attempts
   * they have already used, so the total stays bounded).
   */
  async function retry(organizationId: string): Promise<{ pull: PullOutcome; push: PushOutcome }> {
    const stamp = iso();
    for (const link of await store.listEventLinks(organizationId)) {
      if (link.state === "pending" && link.pendingOp) {
        await store.saveEventLink({ ...link, nextAttemptAt: stamp, updatedAt: stamp });
        continue;
      }
      if (link.state !== "failed") continue;
      await store.saveEventLink({
        ...link,
        state: "pending",
        pendingOp: link.pendingOp ?? "update",
        attempts: 0,
        nextAttemptAt: stamp,
        lastError: undefined,
        updatedAt: stamp,
      });
    }
    const pulled = await pull(organizationId, { full: false });
    const pushed = await push({ organizationId });
    return { pull: pulled, push: pushed };
  }

  /**
   * A calendar was chosen: queue every upcoming appointment, read the calendar
   * for the first time, and ask Google to push changes.
   */
  async function start(organizationId: string) {
    const before = await store.getSyncState(organizationId);
    const opened = await deps.open(organizationId);
    if (
      before?.channelId &&
      opened.ok &&
      before.calendarId &&
      before.calendarId !== opened.calendarId
    ) {
      await opened.client
        .stopChannel({ id: before.channelId, resourceId: before.resourceId })
        .catch(() => undefined);
    }
    await backfill(organizationId);
    const pulled = await pull(organizationId, { full: true });
    const channel = await ensureChannel(organizationId, { force: true }).catch(
      () => "unavailable" as const,
    );
    const pushed = await push({ organizationId });
    return { pull: pulled, push: pushed, channel };
  }

  /**
   * Disconnect. Stops the push channel and revokes the grant at Google (both
   * best-effort), forgets the mirror, the busy blocks and the pull state, and
   * detaches every link. Appointments are never touched.
   */
  async function teardown(organizationId: string): Promise<{ revoked: boolean }> {
    let revoked = false;
    const connection = await store.getConnection(organizationId);
    if (connection?.tokenCiphertext) {
      try {
        const client = createGoogleClient({
          tokens: openTokens(connection.tokenCiphertext),
          fetchImpl: deps.fetchImpl,
          urls: deps.urls,
          timeoutMs: 5000,
        });
        const state = await store.getSyncState(organizationId);
        if (state?.channelId) {
          await client.stopChannel({ id: state.channelId, resourceId: state.resourceId });
        }
        revoked = await client.revoke();
      } catch {
        // Local access is removed whatever Google says.
      }
    }
    await store.clearGoogleSync(organizationId, now());
    return { revoked };
  }

  return {
    enqueue,
    backfill,
    push,
    pull,
    prepare,
    ensureChannel,
    receive,
    tick,
    summary,
    requeueAll,
    retry,
    start,
    teardown,
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export type GoogleSync = ReturnType<typeof createGoogleSync>;
