/**
 * What an external realtime voice agent (the LiveKit agent in /agents/receptionist)
 * needs to answer one business's calls: its rendered instructions and the only
 * numbers it may transfer to.
 *
 * The agent never receives a number from the model or from the caller. It picks
 * between the two lines below, which come from the owner-validated profile
 * (Canadian geographic numbers only, see profile.ts), so a prompt-injected
 * caller cannot make the line dial an arbitrary or premium number.
 */

import { isAfterHours } from "@/product/missed-call/call-handling";
import type { ReceptionistConfig } from "./types";

export type AgentConfig = {
  configId: string;
  businessName: string;
  receptionistName: string | null;
  /** Instructions for the model: the business's prompt plus this call's real capabilities. */
  instructions: string;
  /** First thing said when the call connects. */
  greetings: { fr: string; en: string };
  afterHours: boolean;
  /** Where "talk to a person" goes. Null when no live human is configured. */
  transferE164: string | null;
  /** Where emergencies go (works after hours). Null when none is configured. */
  emergencyTransferE164: string | null;
  /** Named departments the agent may offer. */
  departments: { name: string; phoneE164: string }[];
};

/** Added after the business prompt so it never promises tools the agent lacks. */
export function voiceAgentContext(input: {
  afterHours: boolean;
  canTransfer: boolean;
  canTransferEmergency: boolean;
  departments: string[];
}): string {
  const lines = [
    "# THIS CALL — WHAT YOU CAN ACTUALLY DO (overrides anything above that says otherwise)",
    "",
    `The office is currently ${input.afterHours ? "CLOSED (after hours)" : "OPEN"}.`,
    "",
    "Your only tool is transfer_call. You have no calendar, booking system, messaging system or notification system.",
    "* Never say a time is available, booked, confirmed or scheduled. For appointments, quotes and messages, collect the caller's name, callback number, address and preferred time, repeat them back, then say the team will call back to confirm. Do not give a callback time.",
    "* Never say you submitted, sent or recorded anything. Say you have noted the details and the team will follow up.",
  ];
  if (input.canTransfer || input.canTransferEmergency) {
    lines.push(
      '* To connect the caller with a person, you MUST call the transfer_call tool. Saying "I\'ll transfer you" without calling it does nothing and leaves the caller waiting in silence.',
      "* After calling transfer_call, say nothing more. If it returns a failure, tell the caller briefly and offer to take their details for a callback.",
    );
    if (input.afterHours) {
      lines.push(
        '* The office is closed: only transfer for an emergency (reason "emergency"). Otherwise take a message.',
      );
    }
    if (input.departments.length > 0) {
      lines.push(
        `* Departments you can offer: ${input.departments.join(", ")}.`,
      );
    }
  } else {
    lines.push(
      "* No live transfer is configured. Never offer to transfer; take the caller's details instead.",
    );
  }
  return lines.join("\n");
}

export function buildAgentConfig(
  config: ReceptionistConfig,
  now: Date = new Date(),
): AgentConfig {
  const afterHours = isAfterHours(config, now);
  const emergency =
    config.emergencyTransferE164 ?? config.fallbackTransferE164 ?? null;
  const general = config.fallbackTransferE164 ?? null;
  const departments = config.routing.map((r) => ({
    name: r.name,
    phoneE164: r.phoneE164,
  }));

  const base =
    config.systemPrompt?.trim() ||
    `You are the phone receptionist for ${config.businessName}, a home-services contractor. Be warm, brief and professional. Never invent prices, services or availability.`;

  return {
    configId: config.id,
    businessName: config.businessName,
    receptionistName: config.receptionistName ?? null,
    instructions: `${base}\n\n${voiceAgentContext({
      afterHours,
      canTransfer: general !== null || departments.length > 0,
      canTransferEmergency: emergency !== null,
      departments: departments.map((d) => d.name),
    })}`,
    greetings: {
      fr: config.greetingFr,
      en: config.greetingEn,
    },
    afterHours,
    transferE164: general,
    emergencyTransferE164: emergency,
    departments,
  };
}
