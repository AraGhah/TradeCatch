/**
 * Saving and reloading dashboard simulations.
 *
 * A simulation is stored the same way a real call is (a call record in the
 * receptionist store, lifecycle events in `rc_call_events`) so it survives a
 * refresh and a new login. Nothing here needs a new table:
 *
 * - the call id starts with `sim_live_`, which every owner-facing call list
 *   already treats as a practice call (never listed as a real call, never
 *   counted, never alerted, never metered);
 * - every event carries `payload.simulated = true`;
 * - events have stable ids (`callEventId`), so saving the same run twice, or
 *   a retried request, never adds a second row;
 * - the first event of a run (`test_simulated`) holds the run's header and the
 *   last (`finalized`) its result, so a run can be rebuilt from events alone.
 *
 * Every read is scoped to one business: events by organization id, the call
 * record by the business's client account id.
 */

import type { ReceptionistStore } from "@/product/receptionist/store";
import type { CallSession } from "@/product/receptionist/types";
import { callEventId, type CallEventStore } from "./call-events";
import type {
  SimulatedEvent,
  SimulationFinalStatus,
  SimulationOutput,
  SimulationReceptionist,
  SimulationRouting,
  SimulationRun,
  SimulationTermination,
  TranscriptLine,
} from "./live-test";
import type { CallEvent } from "./types";

export const SIMULATION_CALL_PREFIX = "sim_live_";
const MARKER_KIND = "test_simulated";

export type SimulationScope = {
  organizationId: string;
  clientAccountId: string;
};

export type SimulationStores = {
  events: CallEventStore;
  sessions: ReceptionistStore;
};

/** The run's header travels in the first event's payload. */
type RunHeader = {
  scenario: SimulationRun["scenario"];
  startedAt: string;
  routing: SimulationRouting;
  receptionist: SimulationReceptionist;
  notes: string[];
};

export class SimulationPersistenceError extends Error {
  constructor(readonly stage: "session" | "events") {
    super(`[live-test] could not save the simulation ${stage}`);
    this.name = "SimulationPersistenceError";
  }
}

/** Saves a run. Safe to call again for the same run: it adds nothing the second time. */
export async function saveSimulation(
  output: SimulationOutput,
  scope: SimulationScope,
  stores: SimulationStores,
): Promise<{ created: boolean }> {
  const { run, session } = output;
  if (!run.callSid.startsWith(SIMULATION_CALL_PREFIX)) {
    throw new Error("[live-test] refusing to save a non-simulated call");
  }
  if (session.clientAccountId !== scope.clientAccountId) {
    throw new Error("[live-test] call record belongs to another business");
  }

  let created: boolean;
  try {
    const saved = await stores.sessions.insertSessionIfAbsent(session);
    created = saved.created;
    // A call id that already belongs to another business is never touched.
    if (saved.session.clientAccountId !== scope.clientAccountId) {
      throw new Error("call id belongs to another business");
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "tradecatch.live_test.save_failed",
        stage: "session",
        code: error instanceof Error ? error.name : "Error",
      }),
    );
    throw new SimulationPersistenceError("session");
  }

  const header: RunHeader = {
    scenario: run.scenario,
    startedAt: run.startedAt,
    routing: run.routing,
    receptionist: run.receptionist,
    notes: run.notes,
  };
  try {
    for (const event of run.events) {
      await stores.events.append({
        id: callEventId(run.callSid, event.kind, event.seq),
        organizationId: scope.organizationId,
        clientAccountId: scope.clientAccountId,
        callSid: run.callSid,
        sessionId: session.id,
        kind: event.kind,
        detail: event.detail,
        at: event.at,
        payload: {
          ...event.payload,
          simulated: true,
          seq: event.seq,
          offsetSeconds: event.offsetSeconds,
          ...(event.kind === MARKER_KIND ? { header } : {}),
        },
      });
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "tradecatch.live_test.save_failed",
        stage: "events",
        code: error instanceof Error ? error.name : "Error",
      }),
    );
    throw new SimulationPersistenceError("events");
  }
  return { created };
}

function toSimulatedEvent(event: CallEvent): SimulatedEvent {
  const { header, seq, offsetSeconds, simulated, ...rest } = (event.payload ??
    {}) as Record<string, unknown>;
  void header;
  void simulated;
  return {
    seq: typeof seq === "number" ? seq : 0,
    at: event.at,
    offsetSeconds: typeof offsetSeconds === "number" ? offsetSeconds : 0,
    kind: event.kind,
    detail: event.detail,
    payload: Object.keys(rest).length > 0 ? rest : undefined,
    simulated: true,
  };
}

function transcriptOf(session: CallSession | null): TranscriptLine[] {
  if (!session) return [];
  return session.turns.flatMap((turn): TranscriptLine[] =>
    turn.speaker === "caller" || turn.speaker === "agent"
      ? [
          {
            speaker: turn.speaker === "caller" ? "caller" : "receptionist",
            text: turn.text,
          },
        ]
      : [],
  );
}

export type LoadedSimulation =
  | { complete: true; run: SimulationRun }
  | { complete: false; callSid: string };

/** One saved run, or null when it is not this business's. */
export async function loadSimulation(
  scope: SimulationScope,
  stores: SimulationStores,
  callSid: string,
): Promise<LoadedSimulation | null> {
  if (!callSid.startsWith(SIMULATION_CALL_PREFIX)) return null;
  const stored = await stores.events.listForCall({
    organizationId: scope.organizationId,
    callSid,
    limit: 200,
  });
  const events = stored.filter(
    (e) => e.clientAccountId === scope.clientAccountId,
  );
  const marker = events.find((e) => e.kind === MARKER_KIND);
  if (!marker) return null;
  const header = marker.payload?.header as RunHeader | undefined;
  const finalized = events.find((e) => e.kind === "finalized");
  if (!header || !finalized) return { complete: false, callSid };

  const session = await stores.sessions.getSessionByCallSid(callSid);
  // A call record that is another business's is never used.
  const own = session && session.clientAccountId === scope.clientAccountId ? session : null;
  const result = finalized.payload ?? {};
  const duration =
    typeof result.durationSeconds === "number" ? result.durationSeconds : 0;
  const timeline = events
    .map(toSimulatedEvent)
    .sort((a, b) => a.seq - b.seq || a.at.localeCompare(b.at));

  return {
    complete: true,
    run: {
      simulated: true,
      callSid,
      scenario: header.scenario,
      startedAt: header.startedAt,
      endedAt: new Date(Date.parse(header.startedAt) + duration * 1000).toISOString(),
      durationSeconds: duration,
      finalStatus: result.finalStatus as SimulationFinalStatus,
      outcome: own?.outcome,
      termination: result.termination as SimulationTermination,
      routing: header.routing,
      receptionist: header.receptionist,
      notes: header.notes,
      events: timeline,
      transcript: transcriptOf(own),
      headline: own?.summary?.headline,
    },
  };
}

/** The business's most recent simulations, newest first. */
export async function listSimulations(
  scope: SimulationScope,
  stores: SimulationStores,
  limit = 8,
): Promise<SimulationRun[]> {
  const markers = await stores.events.listForOrganization({
    organizationId: scope.organizationId,
    kind: MARKER_KIND,
    limit: limit * 3,
  });
  const seen = new Set<string>();
  const runs: SimulationRun[] = [];
  for (const marker of markers) {
    if (runs.length >= limit) break;
    if (
      marker.clientAccountId !== scope.clientAccountId ||
      !marker.callSid.startsWith(SIMULATION_CALL_PREFIX) ||
      seen.has(marker.callSid)
    ) {
      continue;
    }
    seen.add(marker.callSid);
    const loaded = await loadSimulation(scope, stores, marker.callSid);
    if (loaded?.complete) runs.push(loaded.run);
  }
  return runs;
}
