import { ReliabilityError } from "./errors";
import type { ReliabilityStore, TouchResult } from "./store";
import type { MonitorThresholds } from "./thresholds";
import {
  PRIORITY_RANK,
  type AlertKind,
  type Incident,
  type Priority,
} from "./types";
import { createId } from "@/lib/id";
import { isWebsiteFingerprint, WEBSITE_FINGERPRINT, websiteRecovered } from "./rules";

/** How far back the website's recovery evidence is read (well past any rule). */
const RECOVERY_LOOKBACK_MS = 30 * 60_000;

/**
 * Incident lifecycle (KAN-28): one incident per fingerprint, tracked
 * Active -> Acknowledged -> Resolved with a full history, alerting once when it
 * opens, again only if it gets worse (or, for critical ones nobody has
 * acknowledged, as a slow reminder), and telling administrators when a
 * critical or high incident recovers. Everything that decides whether an alert
 * goes out lives here, in one place, so grouping, cooldown, storm control and
 * simulation handling cannot drift apart.
 */

export type IncidentReport = {
  fingerprint: string;
  service: string;
  category: string;
  priority: Priority;
  title: string;
  summary?: string;
  organizationId?: string;
  affectedBusinesses?: number;
  quietMs: number;
  correlationId: string;
  /** Simulated incidents are recorded for the console but never emailed. */
  simulated: boolean;
  occurrences?: number;
  /** When this report creates the incident, how many occurrences it already stands for. */
  initialOccurrences?: number;
};

export type ReportOutcome = {
  incident: Incident;
  outcome: TouchResult["outcome"];
  alert: AlertKind | null;
  /** Why an alert that would normally go out did not. */
  suppressed?: "cooldown" | "storm" | "simulated";
};

export type IncidentEngineDeps = {
  store: ReliabilityStore;
  thresholds: MonitorThresholds;
  now: () => Date;
};

export function createIncidentEngine(deps: IncidentEngineDeps) {
  const { store, thresholds } = deps;
  const alerts = thresholds.alerts;

  function decideAlert(result: TouchResult, nowMs: number): { kind: AlertKind | null; suppressed?: "cooldown" } {
    const { incident, outcome } = result;
    const priority = incident.priority ?? "warning";
    if (outcome === "created") return { kind: "opened" };
    if (outcome === "reopened") {
      if (
        incident.lastAlertedAt &&
        nowMs - Date.parse(incident.lastAlertedAt) < alerts.cooldownMs[priority]
      )
        return { kind: null, suppressed: "cooldown" };
      return { kind: "opened" };
    }
    // The incident was already open. Never alerted (a storm or a cooldown held
    // the first alert back) means it is owed one now.
    if (!incident.lastAlertedAt) return { kind: "opened" };
    if (PRIORITY_RANK[priority] > PRIORITY_RANK[incident.alertedPriority ?? "warning"])
      return { kind: "escalated" };
    const reminder = alerts.reminderMs[priority];
    if (
      incident.status === "open" &&
      reminder > 0 &&
      nowMs - Date.parse(incident.lastAlertedAt) >= reminder
    )
      return { kind: "reminder" };
    return { kind: null };
  }

  function idempotencyKey(kind: AlertKind, incident: Incident, nowMs: number): string {
    const reopen = incident.reopenCount ?? 0;
    switch (kind) {
      case "opened":
        return `${incident.id}:opened:${reopen}`;
      case "escalated":
        return `${incident.id}:escalated:${incident.priority}:${reopen}`;
      case "reminder":
        return `${incident.id}:reminder:${Math.floor(nowMs / alerts.reminderMs[incident.priority ?? "warning"])}`;
      case "recovered":
        return `${incident.id}:recovered:${reopen}`;
      default:
        return `${incident.id}:${kind}:${nowMs}`;
    }
  }

  async function enqueue(kind: AlertKind, incident: Incident, nowMs: number): Promise<boolean> {
    const at = new Date(nowMs).toISOString();
    const queued = await store.enqueueAlert({
      id: createId("alert"),
      incidentId: incident.id,
      kind,
      priority: incident.priority ?? "warning",
      status: "pending",
      attempts: 0,
      nextAttemptAt: at,
      idempotencyKey: idempotencyKey(kind, incident, nowMs),
      createdAt: at,
    });
    if (queued && kind !== "recovered")
      await store.markIncidentAlerted(incident.id, {
        at,
        priority: incident.priority ?? "warning",
      });
    return queued;
  }

  async function stormGate(priority: Priority, nowMs: number): Promise<boolean> {
    if (priority === "critical") return false;
    const since = new Date(nowMs - alerts.storm.windowMs).toISOString();
    if ((await store.countAlertsSince(since)) < alerts.storm.maxAlerts) return false;
    const at = new Date(nowMs).toISOString();
    await store.enqueueAlert({
      id: createId("alert"),
      incidentId: null,
      kind: "digest",
      priority: "high",
      status: "pending",
      attempts: 0,
      nextAttemptAt: at,
      idempotencyKey: `digest:${Math.floor(nowMs / alerts.storm.windowMs)}`,
      createdAt: at,
    });
    return true;
  }

  return {
    /** Records that a condition is present right now. Safe to call every minute. */
    async report(input: IncidentReport): Promise<ReportOutcome> {
      const now = deps.now();
      const nowMs = now.getTime();
      const at = now.toISOString();
      const result = await store.touchIncident({
        fingerprint: input.fingerprint,
        service: input.service,
        category: input.category,
        priority: input.priority,
        title: input.title,
        summary: input.summary,
        organizationId: input.organizationId,
        affectedBusinesses: input.affectedBusinesses,
        quietMs: input.quietMs,
        correlationId: input.correlationId,
        simulated: input.simulated,
        now: at,
        reopenWithinMs: alerts.reopenWithinMs,
        occurrences: input.occurrences,
        initialOccurrences: input.initialOccurrences,
      });
      const { incident, outcome, previousPriority } = result;
      if (outcome === "created")
        await store.addIncidentEvent({ incidentId: incident.id, kind: "opened", at });
      else if (outcome === "reopened")
        await store.addIncidentEvent({
          incidentId: incident.id,
          kind: "reopened",
          detail: "The condition returned shortly after resolving.",
          at,
        });
      else if (
        previousPriority &&
        PRIORITY_RANK[incident.priority ?? "warning"] > PRIORITY_RANK[previousPriority]
      )
        await store.addIncidentEvent({
          incidentId: incident.id,
          kind: "escalated",
          detail: `${previousPriority} to ${incident.priority}`,
          at,
        });

      if (incident.simulated || input.simulated)
        return { incident, outcome, alert: null, suppressed: "simulated" };

      const decision = decideAlert(result, nowMs);
      if (!decision.kind)
        return { incident, outcome, alert: null, suppressed: decision.suppressed };

      if (await stormGate(incident.priority ?? "warning", nowMs)) {
        if (outcome !== "touched")
          await store.addIncidentEvent({
            incidentId: incident.id,
            kind: "alert_suppressed",
            detail: "Alert limit reached; included in the summary alert.",
            at,
          });
        return { incident, outcome, alert: null, suppressed: "storm" };
      }
      const queued = await enqueue(decision.kind, incident, nowMs);
      return { incident, outcome, alert: queued ? decision.kind : null };
    },

    /**
     * Records an outage that has already ended, for the case where the failing
     * system is the one that stores incidents (a database that is down cannot
     * open an incident about itself). The "down" email went out directly while
     * it was happening; this stores the incident with its true start, resolves
     * it, and queues the recovery notice. Safe to repeat for the same outage.
     */
    async recordPastOutage(input: {
      fingerprint: string;
      service: string;
      category: string;
      priority: Priority;
      title: string;
      summary?: string;
      correlationId: string;
      startedAt: string;
      simulated?: boolean;
    }): Promise<Incident> {
      const now = deps.now();
      const at = now.toISOString();
      const existing = (await store.listIncidents()).find(
        (row) => row.fingerprint === input.fingerprint && row.firstSeenAt === input.startedAt,
      );
      if (existing) return existing;
      const result = await store.touchIncident({
        fingerprint: input.fingerprint,
        service: input.service,
        category: input.category,
        priority: input.priority,
        title: input.title,
        summary: input.summary,
        quietMs: 0,
        correlationId: input.correlationId,
        simulated: Boolean(input.simulated),
        now: input.startedAt,
        reopenWithinMs: 0,
      });
      const { incident } = result;
      if (result.outcome === "created")
        await store.addIncidentEvent({ incidentId: incident.id, kind: "opened", at: input.startedAt });
      if (!input.simulated)
        await store.markIncidentAlerted(incident.id, { at: input.startedAt, priority: input.priority });
      const resolved = await store.resolveIncident(incident.id, { at, by: "auto" });
      if (!resolved) return incident;
      await store.addIncidentEvent({
        incidentId: incident.id,
        kind: "resolved",
        detail: "Recovered. The outage was recorded after the fact.",
        actor: "auto",
        at,
      });
      if (!input.simulated)
        await enqueue("recovered", { ...resolved, lastAlertedAt: input.startedAt }, now.getTime());
      return resolved;
    },

    /**
     * Resolves incidents whose condition has stayed clear, and announces
     * recoveries. A website incident additionally needs positive evidence: the
     * last `website.recoverySuccesses` checks of every address succeeded. This
     * runs from both the per-minute monitor and the 15-minute health tick, so
     * the rule lives here rather than in either caller.
     */
    async sweepRecovered(): Promise<Incident[]> {
      const now = deps.now();
      const at = now.toISOString();
      const resolved: Incident[] = [];
      let probes: Awaited<ReturnType<ReliabilityStore["listProbes"]>> | undefined;
      for (const candidate of await store.listRecoverableIncidents(at)) {
        let detail = "Condition cleared.";
        if (isWebsiteFingerprint(candidate.fingerprint)) {
          probes ??= await store.listProbes(
            new Date(now.getTime() - RECOVERY_LOOKBACK_MS).toISOString(),
          );
          const target = candidate.fingerprint!.slice(WEBSITE_FINGERPRINT.length + 1);
          if (!websiteRecovered(probes, thresholds, target ? [target] : undefined)) continue;
          detail = `Condition cleared: the last ${thresholds.website.recoverySuccesses} availability checks succeeded.`;
        }
        const incident = await store.resolveIncident(candidate.id, { at, by: "auto" });
        if (!incident) continue;
        resolved.push(incident);
        await store.addIncidentEvent({
          incidentId: incident.id,
          kind: "resolved",
          detail,
          actor: "auto",
          at,
        });
        const priority = incident.priority ?? "warning";
        if (
          !incident.simulated &&
          incident.lastAlertedAt &&
          (priority === "critical" || priority === "high")
        )
          await enqueue("recovered", incident, now.getTime());
      }
      return resolved;
    },

    async acknowledge(id: string, actor: string): Promise<Incident> {
      const current = await store.getIncident(id);
      if (!current) throw new ReliabilityError("Incident not found.", 404);
      if (current.status === "resolved")
        throw new ReliabilityError("This incident is already resolved.", 409);
      if (current.status === "investigating") return current;
      const at = deps.now().toISOString();
      const incident = await store.acknowledgeIncident(id, { at, by: actor });
      if (!incident) throw new ReliabilityError("This incident is already resolved.", 409);
      await store.addIncidentEvent({ incidentId: id, kind: "acknowledged", actor, at });
      return incident;
    },

    async resolve(id: string, actor: string): Promise<Incident> {
      const current = await store.getIncident(id);
      if (!current) throw new ReliabilityError("Incident not found.", 404);
      if (current.status === "resolved") return current;
      const at = deps.now().toISOString();
      const incident = await store.resolveIncident(id, { at, by: actor });
      if (!incident) return (await store.getIncident(id)) ?? current;
      await store.addIncidentEvent({
        incidentId: id,
        kind: "resolved",
        detail: "Resolved by an administrator.",
        actor,
        at,
      });
      // Whoever was told it opened is told it closed, however it closed. The
      // 2026-11-25 20:42 UTC website incident was closed by hand and its
      // recipients never heard that it ended.
      const priority = incident.priority ?? "warning";
      if (
        !incident.simulated &&
        incident.lastAlertedAt &&
        (priority === "critical" || priority === "high")
      )
        await enqueue("recovered", incident, Date.parse(at));
      return incident;
    },
  };
}

export type IncidentEngine = ReturnType<typeof createIncidentEngine>;
