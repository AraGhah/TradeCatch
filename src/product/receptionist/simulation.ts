/**
 * Shared plumbing for side-effect-free receptionist runs (the public website
 * demo and the signed-in business test): a fixed clock, an in-memory store,
 * the deterministic rule brain and a notifier that sends nothing.
 */

import { createRuleBrain } from "./brain-rules";
import { createReceptionistEngine } from "./engine";
import { createMemoryReceptionistStore } from "./store";
import type { ReceptionistConfig, VoicePlan } from "./types";

export type SimulationScenario = "open" | "after_hours";

export type SimulationMessage = { role: "agent" | "system"; text: string };

// Wed 10:00 and Tue 22:00 in America/Toronto (Mon–Fri 08:00–17:00 hours).
const CLOCK: Record<SimulationScenario, Date> = {
  open: new Date("2026-03-04T15:00:00Z"),
  after_hours: new Date("2026-03-04T03:00:00Z"),
};

function silentNotifier() {
  return {
    async deliverSummary() {
      return [];
    },
    async alertEmergency() {
      return [];
    },
  };
}

/** The real call engine with every outbound side effect removed. */
export function createSimulationEngine(
  config: ReceptionistConfig,
  scenario: SimulationScenario,
) {
  const store = createMemoryReceptionistStore();
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: createRuleBrain(),
    notifier: silentNotifier(),
    llm: null,
    clock: { now: () => CLOCK[scenario] },
  });
  return { store, engine };
}

export type SimulationEngine = ReturnType<typeof createSimulationEngine>;

/** What the receptionist says in a plan, without consecutive repeats. */
export function planMessages(plan: VoicePlan): SimulationMessage[] {
  const out: SimulationMessage[] = [];
  const push = (text: string) => {
    const t = text.trim();
    if (t && out.at(-1)?.text !== t) out.push({ role: "agent", text: t });
  };
  for (const verb of plan.verbs) {
    if (verb.verb === "say") push(verb.text);
    else if (verb.verb === "gather") verb.prompts.forEach((p) => push(p.text));
  }
  return out;
}
