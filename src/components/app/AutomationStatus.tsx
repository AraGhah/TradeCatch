"use client";

import { useTranslations } from "next-intl";
import type { AutomationRecord } from "@/product/sms-automation/types";
import { OPERATIONAL_AUTOMATION_TYPES } from "@/product/sms-automation/types";
import {
  deriveAutomationState,
  type AutomationState,
  type AutomationStatus,
  type JobSummary,
} from "@/product/sms-automation/status";

/**
 * What every Automations screen needs to say whether a follow-up is working. Gathered on
 * the server (see `loadStatusInputs`) and handed down, so the overview and the settings
 * pages work out the same status from the same facts.
 */
export type StatusInputs = {
  /** Recent jobs without any customer details. */
  jobs: JobSummary[];
  /** Whether the business has a number to text from; null when that could not be read. */
  senderReady: boolean | null;
  /** TradeCatch has paused missed-call texts for everyone. */
  recoveryTextsSwitchedOff: boolean;
  /** The server's clock, so the server and the browser agree on what is recent. */
  nowIso: string;
};

/** The state of a follow-up, or null for one that is not available yet. */
export function stateOf(
  automation: Pick<AutomationRecord, "type" | "enabled">,
  inputs: StatusInputs,
): AutomationState | null {
  if (!OPERATIONAL_AUTOMATION_TYPES.includes(automation.type)) return null;
  return deriveAutomationState({
    automation,
    jobs: inputs.jobs,
    now: new Date(inputs.nowIso),
    senderReady: inputs.senderReady,
    recoveryTextsSwitchedOff: inputs.recoveryTextsSwitchedOff,
  });
}

const PILL: Record<AutomationStatus | "comingSoon", string> = {
  paused: "border-navy/25 bg-navy/5 text-navy",
  active: "border-green-300 bg-green-50 text-green-900",
  scheduled: "border-navy/30 bg-navy/10 text-navy",
  attention: "border-amber-300 bg-amber-50 text-amber-900",
  comingSoon: "border-navy/15 bg-white text-navy/70",
};

/** The status word. Colour is only a hint: the word itself always says it. */
export function StatusPill({
  state,
  testId,
}: {
  state: AutomationState | null;
  testId: string;
}) {
  const t = useTranslations("app.automations.status");
  const key: AutomationStatus | "comingSoon" = state ? state.status : "comingSoon";
  return (
    <span
      data-testid={testId}
      data-state={key}
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PILL[key]}`}
    >
      {t(key)}
    </span>
  );
}

/** One sentence that says what the status means right now, and what to do when it needs attention. */
export function StatusHelp({
  state,
  testId,
}: {
  state: AutomationState;
  testId: string;
}) {
  const t = useTranslations("app.automations.statusHelp");
  const text =
    state.status === "attention" && state.reason
      ? t(`attention.${state.reason}`)
      : state.status === "scheduled"
        ? t("scheduled", { count: state.waiting })
        : t(state.status);
  return (
    <p data-testid={testId} className="text-sm font-medium text-navy">
      {text}
    </p>
  );
}
