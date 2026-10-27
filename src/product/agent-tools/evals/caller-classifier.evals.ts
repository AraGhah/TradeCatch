/**
 * Eval suite for the caller-classifier safety gate: `classifyUrgency` from
 * `missed-call/urgency.ts`. This is the rule-based rubric that decides
 * whether a missed call gets escalated to a human before any recovery SMS
 * goes out, so it's exercised with real emergency, French, spam, price,
 * and off-topic conversation openers rather than a mock.
 */
import {
  classifyUrgency,
  defaultUrgencyRubric,
} from "@/product/missed-call/urgency";
import type { EvalSuite } from "./types";
import type { UrgencyClassification } from "@/product/missed-call/types";

const rubric = defaultUrgencyRubric();

function critical(id: string, description: string, text: string) {
  return {
    id,
    description,
    input: text,
    expect: (output: UrgencyClassification) => ({
      pass: output.level === "critical" && output.requiresHuman === true,
      reason: `expected critical+requiresHuman, got level=${output.level} requiresHuman=${output.requiresHuman} source=${output.source}`,
    }),
  };
}

function priority(id: string, description: string, text: string) {
  return {
    id,
    description,
    input: text,
    expect: (output: UrgencyClassification) => ({
      pass: output.level === "priority",
      reason: `expected priority, got level=${output.level} source=${output.source}`,
    }),
  };
}

function routineNoEscalation(id: string, description: string, text: string) {
  return {
    id,
    description,
    input: text,
    expect: (output: UrgencyClassification) => ({
      pass: output.level === "routine" && output.requiresHuman === false,
      reason: `expected routine+no escalation, got level=${output.level} requiresHuman=${output.requiresHuman} source=${output.source}`,
    }),
  };
}

export const callerClassifierEvalSuite: EvalSuite<string, UrgencyClassification> = {
  name: "caller-classifier (urgency rubric)",
  run: (issueDescription) =>
    classifyUrgency({ issueDescription, rubric }).classification,
  cases: [
    critical("gas_en", "English gas leak", "I smell gas in my basement"),
    critical("gas_fr", "French gas leak", "Je sens une odeur de gaz dans la cuisine"),
    critical("fire_en", "English fire/smoke", "There is smoke coming from the furnace"),
    critical("fire_fr", "French fire", "Il y a du feu pres du panneau electrique"),
    critical("flood_en", "English flooding", "My basement is flooding right now"),
    critical("flood_fr", "French flooding", "Inondation dans le sous-sol, besoin d'aide urgente"),
    critical(
      "electrical_en",
      "English exposed wire",
      "There is an exposed wire sparking near the panel",
    ),
    critical(
      "structural_en",
      "English structural collapse",
      "Part of the ceiling just had a collapse",
    ),
    priority("no_heat_en", "English no heat in winter", "We have no heat and it's freezing"),
    priority("no_heat_fr", "French no heat", "Pas de chaleur depuis ce matin, chaudiere en panne"),
    priority("water_leak_en", "English major water leak", "There is a major leak, water everywhere"),
    priority("water_leak_fr", "French water leak", "Fuite d'eau importante sous l'evier"),
    routineNoEscalation(
      "maintenance_en",
      "Routine maintenance request",
      "Looking to schedule maintenance for our furnace next month",
    ),
    routineNoEscalation(
      "maintenance_fr",
      "French routine maintenance",
      "Je voudrais planifier un entretien pour la chaudiere",
    ),
    routineNoEscalation(
      "price_request",
      "Price/quote request must not be treated as an emergency",
      "Can you give me a quote for a new water heater installation",
    ),
    routineNoEscalation(
      "off_topic",
      "Off-topic message must stay routine, not spuriously escalate",
      "Hi, do you also sell gas stoves? Just asking about products.",
    ),
    {
      id: "short_description_uncertain",
      description:
        "Very short/ambiguous descriptions must route to a human instead of guessing",
      input: "help",
      expect: (output: UrgencyClassification) => ({
        pass: output.requiresHuman === true && output.source === "uncertain:short_description",
        reason: `expected uncertain:short_description with requiresHuman, got ${JSON.stringify(output)}`,
      }),
    },
  ],
};
