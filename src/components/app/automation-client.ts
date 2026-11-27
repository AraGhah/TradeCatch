"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, requestJson } from "@/lib/client/request";
import type { AutomationConfig, AutomationRecord } from "@/product/sms-automation/types";

/**
 * What the Automations screens share: one request at a time per control, a message that
 * says what actually happened, and values that always come from the server's answer.
 *
 * The rules, because each was a bug:
 *  - The lock is a plain ref, set synchronously. A disabled button is only disabled after
 *    React re-renders, so a second click in the same tick used to send a second request.
 *  - Success is shown only after the server answered with the stored value.
 *  - After any failure the screen asks the server what is stored and shows that, so a
 *    save that timed out on the way back is not shown as lost, nor a lost one as saved.
 */

export type FailureKind =
  | "rate_limited"
  | "offline"
  | "unavailable"
  | "denied"
  | "signed_out"
  | "invalid"
  | "conflict"
  | "unconfirmed"
  | "generic";

export type Failure = {
  kind: FailureKind;
  /** Seconds to wait, for `rate_limited`. */
  seconds?: number;
  /** Settings the server refused, by name. */
  fields?: string[];
  /** The server's own sentence, when it gave one (a 400 or 409). */
  detail?: string;
};

export function describeFailure(err: unknown): Failure {
  if (err instanceof ApiError) {
    const body = (err.body ?? {}) as { error?: unknown; fields?: unknown };
    const detail = typeof body.error === "string" ? body.error : undefined;
    const fields = Array.isArray(body.fields)
      ? body.fields.filter((f): f is string => typeof f === "string")
      : undefined;
    switch (err.kind) {
      case "rate_limited":
        return { kind: "rate_limited", seconds: Math.max(1, Math.ceil((err.retryAfterMs ?? 5_000) / 1_000)) };
      case "network":
        return { kind: "offline" };
      case "unavailable":
        return { kind: "unavailable" };
      case "unauthorized":
        return { kind: "signed_out" };
      case "forbidden":
      case "blocked":
        return { kind: "denied" };
      case "client":
        if (err.status === 409) return { kind: "conflict", detail };
        // A refused setting (400/422). Anything else a client error can be, such as a
        // missing automation (404), is not something the person typed wrong.
        if (err.status === 400 || err.status === 422) return { kind: "invalid", detail, fields };
        return { kind: "generic" };
      case "invalid_response":
        return { kind: "unconfirmed" };
      default:
        return { kind: "generic" };
    }
  }
  return { kind: "generic" };
}

/**
 * Which explanation fits a 409. The server says why in English; this only picks the
 * matching sentence in the person's language and never shows the server's words.
 * Pinned against the server's real messages in tests/unit/automations-copy.test.ts.
 */
export function conflictKey(detail: string | undefined): "failures.turnOnFirst" | "failures.notAvailable" | "failures.conflict" {
  if (detail && /before simulating|recovery first|follow-up first/i.test(detail)) return "failures.turnOnFirst";
  if (detail && /not operational/i.test(detail)) return "failures.notAvailable";
  return "failures.conflict";
}

/** The sentence for a failure, in the person's language. */
export function useFailureText() {
  const t = useTranslations("app.automations");
  return useCallback(
    (failure: Failure): string => {
      switch (failure.kind) {
        case "rate_limited":
          return t("failures.rateLimited", { seconds: failure.seconds ?? 5 });
        case "offline":
          return t("failures.offline");
        case "unavailable":
          return t("failures.unavailable");
        case "denied":
          return t("failures.denied");
        case "signed_out":
          return t("failures.signedOut");
        case "unconfirmed":
          return t("failures.unconfirmed");
        case "invalid": {
          const named = (failure.fields ?? [])
            .map((field) => (t.has(`invalid.${field}`) ? t(`invalid.${field}` as "invalid.initial_delay") : null))
            .filter((line): line is string => Boolean(line));
          if (named.length > 0) return named.join(" ");
          // The server's own sentence is English and written for developers ("Invalid
          // settings."), so it is never shown; the screen explains in the person's language.
          return t("failures.invalid");
        }
        case "conflict":
          return t(conflictKey(failure.detail));
        default:
          return t("failures.generic");
      }
    },
    [t],
  );
}

const base = (organizationId: string) => `/api/businesses/${organizationId}`;

/** Sets the switch to a value (never "toggles"), so repeating or racing a request is harmless. */
export async function requestEnabled(
  organizationId: string,
  automationId: string,
  enabled: boolean,
): Promise<{ automation: AutomationRecord; canceled: number }> {
  const data = await requestJson<{ automation?: AutomationRecord; canceled?: number }>(
    `${base(organizationId)}/automations/${automationId}/${enabled ? "activate" : "deactivate"}`,
    { method: "POST", timeoutMs: 30_000 },
  );
  // Only the stored value counts as done.
  if (!data?.automation || data.automation.enabled !== enabled) {
    throw new ApiError("invalid_response", 200, "The server did not confirm the change.");
  }
  return { automation: data.automation, canceled: data.canceled ?? 0 };
}

export async function requestSettings(
  organizationId: string,
  automationId: string,
  patch: Partial<AutomationConfig>,
): Promise<AutomationRecord> {
  const data = await requestJson<{ automation?: AutomationRecord }>(
    `${base(organizationId)}/automations/${automationId}`,
    { method: "PATCH", body: patch, timeoutMs: 30_000 },
  );
  if (!data?.automation?.config) {
    throw new ApiError("invalid_response", 200, "The server did not confirm the change.");
  }
  return data.automation;
}

/** What is stored right now, or null when it cannot be read. Never throws. */
export async function readStored(
  organizationId: string,
  automationId: string,
): Promise<AutomationRecord | null> {
  try {
    const data = await requestJson<{ automation?: AutomationRecord }>(
      `${base(organizationId)}/automations/${automationId}`,
      { retries: 1, dedupe: false },
    );
    return data?.automation ?? null;
  } catch {
    return null;
  }
}

/**
 * One request at a time per key. `run` returns undefined when one is already running for
 * that key (the click is dropped, not queued), and never rejects.
 */
export function useKeyedSingleFlight() {
  const running = useRef(new Set<string>());
  const mounted = useRef(true);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async <T,>(key: string, task: () => Promise<T>): Promise<T | undefined> => {
    if (running.current.has(key)) return undefined;
    running.current.add(key);
    if (mounted.current) setPending(new Set(running.current));
    try {
      return await task();
    } finally {
      running.current.delete(key);
      if (mounted.current) setPending(new Set(running.current));
    }
  }, []);
  return { run, isPending: (key: string) => pending.has(key), anyPending: pending.size > 0 };
}
