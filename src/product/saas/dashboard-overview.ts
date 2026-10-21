/**
 * Period dashboard math for one business.
 * Counts come only from the records passed in. Missing amounts stay null.
 */

export type DashboardPreset = "today" | "7d" | "30d" | "custom";

export type ResolvedDashboardRange = {
  preset: DashboardPreset;
  timeZone: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
};

export type DashboardCallInput = {
  id: string;
  fromE164: string;
  startedAt: string;
  status: "in_progress" | "transferring" | "completed" | "failed" | string;
  outcome?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  transcriptPurgedAt?: string;
  callerName?: string;
  issue?: string;
  intent?: string;
  urgency?: string;
  aiSummary?: string;
  headline?: string;
  nextStep?: string;
  transfersCompleted: number;
  turns: { speaker: "caller" | "agent"; text: string }[];
};

export type DashboardCrmLeadInput = {
  id: string;
  name: string;
  phone?: string;
  status: string;
  source: string;
  service?: string;
  createdAt: string;
  missedCallLeadId?: string;
};

export type DashboardRecoveryInput = {
  id: string;
  name: string;
  createdAt: string;
  jobAccepted?: boolean;
  becameBooking?: boolean;
  outcome: string;
  estimatedValue?: number;
  finalValue?: number;
  technicianResponseMs?: number;
  replied: boolean;
  humanReview: boolean;
};

export type DashboardAppointmentInput = {
  id: string;
  customerName?: string;
  serviceName: string;
  startAt: string;
  endAt?: string;
  status: string;
  bookingSource: string;
  createdAt: string;
  updatedAt: string;
  serviceAddress?: string;
};

export type DashboardRevenueInput = {
  amount: number;
  occurredAt: string;
};

export type DashboardNoticeInput = {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  href?: string;
  createdAt: string;
  unread: boolean;
};

export type DashboardPipelineInput = {
  stage: string;
  estimatedValue?: number;
};

export type DashboardReviewInput = {
  status: string;
  sentAt?: string;
  createdAt: string;
};

export type Delta = {
  current: number;
  previous: number;
  /** Null when the previous window is empty and a percentage would be misleading. */
  changePct: number | null;
};

export type AverageMetric = {
  current: number | null;
  previous: number | null;
  samples: number;
  previousSamples: number;
  changePct: number | null;
};

export type MoneyMetric = {
  current: number | null;
  previous: number | null;
  samples: number;
  changePct: number | null;
  currency: "CAD";
};

export type DashboardSeriesPoint = {
  label: string;
  calls: number | null;
  leads: number | null;
  appointments: number | null;
};

export type DashboardActivityItem = {
  id: string;
  kind: "call" | "lead" | "appointment" | "notice" | "recovery";
  at: string;
  title: string;
  detail: string;
  href?: string;
};

export type DashboardAiCall = {
  id: string;
  at: string;
  caller: string;
  phone: string;
  outcome?: string;
  intent?: string;
  durationSeconds?: number;
  summary?: string;
  nextStep?: string;
  recordingUrl?: string;
  transcriptPurged: boolean;
  followUp: boolean;
  transferred: boolean;
  appointmentRequested: boolean;
  appointmentBooked: boolean;
  turns: { speaker: "caller" | "agent"; text: string }[];
};

export type DashboardCallRow = {
  id: string;
  at: string;
  caller: string;
  phone: string;
  outcome?: string;
  intent?: string;
  classification: "answered" | "missed" | "open";
  aiHandled: boolean;
  transferred: boolean;
  followUp: boolean;
  durationSeconds?: number;
  summary?: string;
};

export type DashboardLeadRow = {
  id: string;
  at: string;
  name: string;
  phone?: string;
  status: string;
  source: string;
  service?: string;
  href: string;
};

export type DashboardAppointmentRow = {
  id: string;
  at: string;
  customerName?: string;
  serviceName: string;
  startAt: string;
  status: string;
  bookingSource: string;
  serviceAddress?: string;
};

export type DashboardOverview = {
  generatedAt: string;
  range: ResolvedDashboardRange;
  sources: {
    calls: "ready" | "unlinked" | "error";
    leads: "ready" | "error";
    recovery: "ready" | "unlinked" | "error";
    appointments: "ready" | "error";
    revenue: "ready" | "plan" | "error";
    notices: "ready" | "error";
    pipeline: "ready" | "plan" | "error";
    reviews: "ready" | "plan" | "error";
  };
  truncated: { calls: boolean; leads: boolean };
  calls: null | {
    incoming: Delta;
    answered: Delta;
    missed: Delta;
    open: Delta;
    aiHandled: Delta;
    transferred: Delta;
    followUp: Delta;
    avgDurationSeconds: AverageMetric;
  };
  leads: null | { captured: Delta };
  recovery: null | {
    missedCallLeads: Delta;
    recovered: Delta;
    replied: Delta;
    needsAttention: Delta;
    jobsAccepted: Delta;
    avgResponseMs: AverageMetric;
    estimatedValue: MoneyMetric;
  };
  appointments: null | {
    booked: Delta;
    completed: Delta;
    canceled: Delta;
    aiBooked: Delta;
    upcoming: number;
  };
  recordedRevenue: MoneyMetric | null;
  pipelineEstimate: number | null;
  reviewsSent: Delta | null;
  series: DashboardSeriesPoint[];
  outcomes: { key: string; count: number }[];
  activity: DashboardActivityItem[];
  aiCalls: DashboardAiCall[];
  callRows: DashboardCallRow[];
  leadRows: DashboardLeadRow[];
  appointmentRows: DashboardAppointmentRow[];
  notices: DashboardNoticeInput[];
};

const ANSWERED = new Set([
  "message_taken",
  "appointment_requested",
  "appointment_booked",
  "transferred",
  "emergency_transferred",
  "faq_answered",
]);

const MISSED = new Set(["voicemail", "caller_hung_up", "failed"]);

const RECOVERED_OUTCOMES = new Set(["technician_accepted", "resolved"]);

const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export function safeTimeZone(timeZone: string | null | undefined): string {
  const zone = timeZone?.trim() || "America/Toronto";
  try {
    Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return "America/Toronto";
  }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
  };
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(bag.year),
    Number(bag.month) - 1,
    Number(bag.day),
    Number(bag.hour),
    Number(bag.minute),
    Number(bag.second),
  );
  return asUtc - date.getTime();
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const first = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  return new Date(guess.getTime() - zoneOffsetMs(first, timeZone));
}

function startOfZonedDay(date: Date, timeZone: string): Date {
  const parts = zonedParts(date, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timeZone);
}

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDays(date: Date, days: number, timeZone: string): Date {
  const parts = zonedParts(date, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return zonedTimeToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
    timeZone,
  );
}

function parseCivilDate(value: string, timeZone: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const instant = zonedTimeToUtc(year, month, day, 0, 0, timeZone);
  const check = zonedParts(instant, timeZone);
  if (check.year !== year || check.month !== month || check.day !== day) return null;
  return instant;
}

export function resolveDashboardRange(input: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  now: Date;
  timeZone: string;
}): ResolvedDashboardRange {
  const timeZone = safeTimeZone(input.timeZone);
  const now = input.now;
  const preset = input.range;

  if (preset === "today") {
    const from = startOfZonedDay(now, timeZone);
    const previousFrom = addCalendarDays(from, -1, timeZone);
    const elapsed = now.getTime() - from.getTime();
    return {
      preset,
      timeZone,
      from: from.toISOString(),
      to: now.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousTo: new Date(previousFrom.getTime() + elapsed).toISOString(),
    };
  }

  if (preset === "custom") {
    const start = input.from ? parseCivilDate(input.from, timeZone) : null;
    const endDay = input.to ? parseCivilDate(input.to, timeZone) : null;
    if (start && endDay) {
      let from = start;
      let to = addCalendarDays(endDay, 1, timeZone);
      if (to.getTime() <= from.getTime()) {
        from = endDay;
        to = addCalendarDays(start, 1, timeZone);
      }
      if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
        from = new Date(to.getTime() - MAX_RANGE_MS);
      }
      if (to.getTime() > now.getTime()) to = now;
      const length = Math.max(to.getTime() - from.getTime(), 60_000);
      return {
        preset: "custom",
        timeZone,
        from: from.toISOString(),
        to: to.toISOString(),
        previousFrom: new Date(from.getTime() - length).toISOString(),
        previousTo: from.toISOString(),
      };
    }
  }

  const days = preset === "30d" ? 30 : 7;
  const to = now;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    preset: days === 30 ? "30d" : "7d",
    timeZone,
    from: from.toISOString(),
    to: to.toISOString(),
    previousFrom: new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    previousTo: from.toISOString(),
  };
}

function stamp(iso: string): number | null {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function inWindow(iso: string, fromMs: number, toMs: number): boolean {
  const value = stamp(iso);
  return value != null && value >= fromMs && value < toMs;
}

function deltaFrom(current: number, previous: number): Delta {
  return { current, previous, changePct: percentChange(current, previous) };
}

function averageOf(values: number[], previous: number[]): AverageMetric {
  const mean = (rows: number[]) =>
    rows.length === 0 ? null : rows.reduce((sum, value) => sum + value, 0) / rows.length;
  const current = mean(values);
  const previousMean = mean(previous);
  return {
    current,
    previous: previousMean,
    samples: values.length,
    previousSamples: previous.length,
    changePct:
      current == null || previousMean == null || previousMean === 0
        ? null
        : percentChange(current, previousMean),
  };
}

function moneyOf(current: number[], previous: number[]): MoneyMetric {
  const sum = (rows: number[]) => rows.reduce((total, value) => total + value, 0);
  return {
    current: current.length > 0 ? sum(current) : null,
    previous: previous.length > 0 ? sum(previous) : null,
    samples: current.length,
    changePct:
      current.length === 0 || previous.length === 0 || sum(previous) === 0
        ? current.length === 0 && previous.length === 0
          ? 0
          : null
        : percentChange(sum(current), sum(previous)),
    currency: "CAD",
  };
}

function positiveAmount(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function classifyCall(call: DashboardCallInput): "answered" | "missed" | "open" {
  if (call.outcome && ANSWERED.has(call.outcome)) return "answered";
  if (call.outcome && MISSED.has(call.outcome)) return "missed";
  if (call.status === "failed") return "missed";
  return "open";
}

function callHandledByAi(call: DashboardCallInput): boolean {
  if (call.turns.some((turn) => turn.speaker === "agent")) return true;
  return (
    call.outcome === "message_taken" ||
    call.outcome === "appointment_requested" ||
    call.outcome === "appointment_booked" ||
    call.outcome === "faq_answered"
  );
}

function callTransferred(call: DashboardCallInput): boolean {
  return (
    call.transfersCompleted > 0 ||
    call.outcome === "transferred" ||
    call.outcome === "emergency_transferred"
  );
}

function callNeedsFollowUp(call: DashboardCallInput): boolean {
  const classification = classifyCall(call);
  if (classification === "missed") return true;
  if (call.outcome === "message_taken") return true;
  if (call.urgency === "critical" && !callTransferred(call)) return true;
  return false;
}

function durationOf(call: DashboardCallInput): number | null {
  if (typeof call.durationSeconds !== "number" || !Number.isFinite(call.durationSeconds)) {
    return null;
  }
  if (call.durationSeconds <= 0) return null;
  return call.durationSeconds;
}

function recoveryValue(lead: DashboardRecoveryInput): number | null {
  return positiveAmount(lead.finalValue) ?? positiveAmount(lead.estimatedValue);
}

function isRecovered(lead: DashboardRecoveryInput): boolean {
  return Boolean(
    lead.jobAccepted || lead.becameBooking || RECOVERED_OUTCOMES.has(lead.outcome),
  );
}

function responseMs(lead: DashboardRecoveryInput): number | null {
  if (
    typeof lead.technicianResponseMs !== "number" ||
    !Number.isFinite(lead.technicianResponseMs) ||
    lead.technicianResponseMs < 0
  ) {
    return null;
  }
  return lead.technicianResponseMs;
}

function safeRecording(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
  } catch {
    return undefined;
  }
  return undefined;
}

function callerLabel(call: DashboardCallInput): string {
  return call.callerName?.trim() || call.fromE164;
}

function isCanceled(status: string): boolean {
  return status === "canceled" || status === "cancelled";
}

function isBookedStatus(status: string): boolean {
  return status === "pending" || status === "confirmed" || status === "completed" || isCanceled(status);
}

function weekLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  const weekday = utc.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  utc.setUTCDate(utc.getUTCDate() + mondayOffset);
  return utc.toISOString().slice(0, 10);
}

function countDelta<T>(
  rows: T[],
  at: (row: T) => string,
  match: (row: T) => boolean,
  currentFrom: number,
  currentTo: number,
  previousFrom: number,
  previousTo: number,
): Delta {
  let current = 0;
  let previous = 0;
  for (const row of rows) {
    if (!match(row)) continue;
    const when = at(row);
    if (inWindow(when, currentFrom, currentTo)) current += 1;
    else if (inWindow(when, previousFrom, previousTo)) previous += 1;
  }
  return deltaFrom(current, previous);
}

export function buildDashboardOverview(input: {
  now: Date;
  range: ResolvedDashboardRange;
  calls: DashboardCallInput[] | null;
  leads: DashboardCrmLeadInput[] | null;
  recovery: DashboardRecoveryInput[] | null;
  appointments: DashboardAppointmentInput[] | null;
  revenue: DashboardRevenueInput[] | null;
  notices: DashboardNoticeInput[] | null;
  pipeline: DashboardPipelineInput[] | null;
  reviews: DashboardReviewInput[] | null;
  sources: DashboardOverview["sources"];
  truncated: { calls: boolean; leads: boolean };
}): DashboardOverview {
  const currentFrom = Date.parse(input.range.from);
  const currentTo = Date.parse(input.range.to);
  const previousFrom = Date.parse(input.range.previousFrom);
  const previousTo = Date.parse(input.range.previousTo);
  const timeZone = input.range.timeZone;

  const calls = input.calls;
  const callBlock =
    calls == null
      ? null
      : {
          incoming: countDelta(
            calls,
            (row) => row.startedAt,
            () => true,
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          answered: countDelta(
            calls,
            (row) => row.startedAt,
            (row) => classifyCall(row) === "answered",
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          missed: countDelta(
            calls,
            (row) => row.startedAt,
            (row) => classifyCall(row) === "missed",
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          open: countDelta(
            calls,
            (row) => row.startedAt,
            (row) => classifyCall(row) === "open",
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          aiHandled: countDelta(
            calls,
            (row) => row.startedAt,
            callHandledByAi,
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          transferred: countDelta(
            calls,
            (row) => row.startedAt,
            callTransferred,
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          followUp: countDelta(
            calls,
            (row) => row.startedAt,
            callNeedsFollowUp,
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          avgDurationSeconds: averageOf(
            calls
              .filter((row) => inWindow(row.startedAt, currentFrom, currentTo))
              .map(durationOf)
              .filter((value): value is number => value != null),
            calls
              .filter((row) => inWindow(row.startedAt, previousFrom, previousTo))
              .map(durationOf)
              .filter((value): value is number => value != null),
          ),
        };

  const leads = input.leads;
  const leadBlock =
    leads == null
      ? null
      : {
          captured: countDelta(
            leads,
            (row) => row.createdAt,
            () => true,
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
        };

  const recovery = input.recovery;
  const recoveryBlock =
    recovery == null
      ? null
      : {
          missedCallLeads: countDelta(
            recovery,
            (row) => row.createdAt,
            () => true,
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          recovered: countDelta(
            recovery,
            (row) => row.createdAt,
            isRecovered,
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          replied: countDelta(
            recovery,
            (row) => row.createdAt,
            (row) => row.replied,
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          needsAttention: countDelta(
            recovery,
            (row) => row.createdAt,
            (row) => row.humanReview,
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          jobsAccepted: countDelta(
            recovery,
            (row) => row.createdAt,
            (row) => Boolean(row.jobAccepted) || row.outcome === "technician_accepted",
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          avgResponseMs: averageOf(
            recovery
              .filter((row) => inWindow(row.createdAt, currentFrom, currentTo))
              .map(responseMs)
              .filter((value): value is number => value != null),
            recovery
              .filter((row) => inWindow(row.createdAt, previousFrom, previousTo))
              .map(responseMs)
              .filter((value): value is number => value != null),
          ),
          estimatedValue: moneyOf(
            recovery
              .filter((row) => inWindow(row.createdAt, currentFrom, currentTo))
              .map(recoveryValue)
              .filter((value): value is number => value != null),
            recovery
              .filter((row) => inWindow(row.createdAt, previousFrom, previousTo))
              .map(recoveryValue)
              .filter((value): value is number => value != null),
          ),
        };

  const appointments = input.appointments;
  const appointmentBlock =
    appointments == null
      ? null
      : {
          booked: countDelta(
            appointments,
            (row) => row.createdAt,
            (row) => isBookedStatus(row.status),
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          completed: countDelta(
            appointments,
            (row) => row.updatedAt,
            (row) => row.status === "completed",
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          canceled: countDelta(
            appointments,
            (row) => row.updatedAt,
            (row) => isCanceled(row.status),
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          aiBooked: countDelta(
            appointments,
            (row) => row.createdAt,
            (row) => row.bookingSource === "ai_receptionist" && isBookedStatus(row.status),
            currentFrom,
            currentTo,
            previousFrom,
            previousTo,
          ),
          upcoming: appointments.filter((row) => {
            const start = stamp(row.startAt);
            return (
              start != null &&
              start >= input.now.getTime() &&
              (row.status === "pending" || row.status === "confirmed")
            );
          }).length,
        };

  const recordedRevenue =
    input.revenue == null
      ? null
      : moneyOf(
          input.revenue
            .filter((row) => inWindow(row.occurredAt, currentFrom, currentTo))
            .map((row) => positiveAmount(row.amount))
            .filter((value): value is number => value != null),
          input.revenue
            .filter((row) => inWindow(row.occurredAt, previousFrom, previousTo))
            .map((row) => positiveAmount(row.amount))
            .filter((value): value is number => value != null),
        );

  let pipelineEstimate: number | null = null;
  if (input.pipeline) {
    let sum = 0;
    let samples = 0;
    for (const card of input.pipeline) {
      if (card.stage === "lost") continue;
      const amount = positiveAmount(card.estimatedValue);
      if (amount == null) continue;
      sum += amount;
      samples += 1;
    }
    pipelineEstimate = samples > 0 ? sum : null;
  }

  const reviewsSent =
    input.reviews == null
      ? null
      : countDelta(
          input.reviews,
          (row) => row.sentAt || row.createdAt,
          (row) => row.status === "sent" || row.status === "clicked",
          currentFrom,
          currentTo,
          previousFrom,
          previousTo,
        );

  const span = currentTo - currentFrom;
  const weekly = span > 45 * 24 * 60 * 60 * 1000;
  const bucketKeys: string[] = [];
  const bucketIndex = new Map<string, number>();
  if (Number.isFinite(currentFrom) && Number.isFinite(currentTo) && currentTo > currentFrom) {
    let cursor = startOfZonedDay(new Date(currentFrom), timeZone);
    let guard = 0;
    while (cursor.getTime() < currentTo && guard < 400) {
      const key = weekly ? weekLabel(dayKey(cursor, timeZone)) : dayKey(cursor, timeZone);
      if (!bucketIndex.has(key)) {
        bucketIndex.set(key, bucketKeys.length);
        bucketKeys.push(key);
      }
      cursor = addCalendarDays(cursor, 1, timeZone);
      guard += 1;
    }
  }

  const series: DashboardSeriesPoint[] = bucketKeys.map((label) => ({
    label,
    calls: calls ? 0 : null,
    leads: leads ? 0 : null,
    appointments: appointments ? 0 : null,
  }));

  function bump(
    iso: string,
    field: "calls" | "leads" | "appointments",
  ) {
    const when = stamp(iso);
    if (when == null || when < currentFrom || when >= currentTo) return;
    const key = weekly
      ? weekLabel(dayKey(new Date(when), timeZone))
      : dayKey(new Date(when), timeZone);
    const index = bucketIndex.get(key);
    if (index == null) return;
    const point = series[index];
    const value = point[field];
    if (value != null) point[field] = value + 1;
  }

  if (calls) {
    for (const call of calls) bump(call.startedAt, "calls");
  }
  if (leads) {
    for (const lead of leads) bump(lead.createdAt, "leads");
  }
  if (appointments) {
    for (const appointment of appointments) {
      if (!isBookedStatus(appointment.status)) continue;
      bump(appointment.createdAt, "appointments");
    }
  }

  const outcomeCounts = new Map<string, number>();
  const callRows: DashboardCallRow[] = [];
  const aiCalls: DashboardAiCall[] = [];
  if (calls) {
    const currentCalls = calls
      .filter((call) => inWindow(call.startedAt, currentFrom, currentTo))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    for (const call of currentCalls) {
      if (call.outcome) outcomeCounts.set(call.outcome, (outcomeCounts.get(call.outcome) ?? 0) + 1);
      const classification = classifyCall(call);
      const aiHandled = callHandledByAi(call);
      const transferred = callTransferred(call);
      const followUp = callNeedsFollowUp(call);
      callRows.push({
        id: call.id,
        at: call.startedAt,
        caller: callerLabel(call),
        phone: call.fromE164,
        outcome: call.outcome,
        intent: call.intent,
        classification,
        aiHandled,
        transferred,
        followUp,
        durationSeconds: durationOf(call) ?? undefined,
        summary: call.aiSummary || call.headline,
      });
      if (aiHandled || transferred || followUp || call.turns.length > 0) {
        aiCalls.push({
          id: call.id,
          at: call.startedAt,
          caller: callerLabel(call),
          phone: call.fromE164,
          outcome: call.outcome,
          intent: call.intent,
          durationSeconds: durationOf(call) ?? undefined,
          summary: call.aiSummary || call.headline,
          nextStep: call.nextStep,
          recordingUrl: safeRecording(call.recordingUrl),
          transcriptPurged: Boolean(call.transcriptPurgedAt),
          followUp,
          transferred,
          appointmentRequested: call.outcome === "appointment_requested",
          appointmentBooked: call.outcome === "appointment_booked",
          turns: call.turns
            .filter((turn) => turn.text.trim())
            .slice(-8)
            .map((turn) => ({
              speaker: turn.speaker,
              text: turn.text.trim().slice(0, 360),
            })),
        });
      }
    }
  }

  const crmByMissed = new Map<string, string>();
  const leadRows: DashboardLeadRow[] = [];
  if (leads) {
    for (const lead of leads) {
      if (lead.missedCallLeadId) crmByMissed.set(lead.missedCallLeadId, lead.id);
      if (!inWindow(lead.createdAt, currentFrom, currentTo)) continue;
      leadRows.push({
        id: lead.id,
        at: lead.createdAt,
        name: lead.name,
        phone: lead.phone,
        status: lead.status,
        source: lead.source,
        service: lead.service,
        href: `/app/leads/${lead.id}`,
      });
    }
    leadRows.sort((a, b) => b.at.localeCompare(a.at));
  }

  const appointmentRows: DashboardAppointmentRow[] = [];
  if (appointments) {
    for (const appointment of appointments) {
      const createdHere = inWindow(appointment.createdAt, currentFrom, currentTo);
      const updatedHere = inWindow(appointment.updatedAt, currentFrom, currentTo);
      if (!createdHere && !updatedHere) continue;
      appointmentRows.push({
        id: appointment.id,
        at: appointment.createdAt,
        customerName: appointment.customerName,
        serviceName: appointment.serviceName,
        startAt: appointment.startAt,
        status: appointment.status,
        bookingSource: appointment.bookingSource,
        serviceAddress: appointment.serviceAddress,
      });
    }
    appointmentRows.sort((a, b) => b.startAt.localeCompare(a.startAt));
  }

  const activity: DashboardActivityItem[] = [];
  for (const call of callRows.slice(0, 12)) {
    activity.push({
      id: `call:${call.id}`,
      kind: "call",
      at: call.at,
      title: call.caller,
      detail: call.outcome || call.classification,
      href: `/app/calls`,
    });
  }
  for (const lead of leadRows.slice(0, 12)) {
    activity.push({
      id: `lead:${lead.id}`,
      kind: "lead",
      at: lead.at,
      title: lead.name,
      detail: lead.status,
      href: lead.href,
    });
  }
  if (recovery) {
    for (const lead of recovery) {
      if (!inWindow(lead.createdAt, currentFrom, currentTo)) continue;
      if (crmByMissed.has(lead.id)) continue;
      activity.push({
        id: `recovery:${lead.id}`,
        kind: "recovery",
        at: lead.createdAt,
        title: lead.name,
        detail: lead.outcome,
        href: "/app/calls",
      });
    }
  }
  for (const appointment of appointmentRows.slice(0, 12)) {
    activity.push({
      id: `appointment:${appointment.id}`,
      kind: "appointment",
      at: appointment.at,
      title: appointment.customerName || appointment.serviceName,
      detail: appointment.status,
      href: "/app/bookings",
    });
  }

  const notices = (input.notices ?? [])
    .slice()
    .sort((a, b) => Number(b.unread) - Number(a.unread) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
  for (const notice of notices) {
    if (!inWindow(notice.createdAt, currentFrom, currentTo) && !notice.unread) continue;
    activity.push({
      id: `notice:${notice.id}`,
      kind: "notice",
      at: notice.createdAt,
      title: notice.title,
      detail: notice.type,
      href: notice.href || "/app/notifications",
    });
  }
  activity.sort((a, b) => b.at.localeCompare(a.at));

  return {
    generatedAt: input.now.toISOString(),
    range: input.range,
    sources: input.sources,
    truncated: input.truncated,
    calls: callBlock,
    leads: leadBlock,
    recovery: recoveryBlock,
    appointments: appointmentBlock,
    recordedRevenue,
    pipelineEstimate,
    reviewsSent,
    series,
    outcomes: [...outcomeCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count),
    activity: activity.slice(0, 16),
    aiCalls: aiCalls.slice(0, 40),
    callRows: callRows.slice(0, 200),
    leadRows: leadRows.slice(0, 200),
    appointmentRows: appointmentRows.slice(0, 200),
    notices,
  };
}
