/**
 * Whether an activated receptionist config should answer *right now*, based on
 * the owner-configured callHandlingMode and business hours.
 */

import { isAfterHours } from "@/product/missed-call/call-handling";
import type { CallHandlingMode, ReceptionistConfig } from "./types";

export function shouldAnswerCall(
  config: Pick<
    ReceptionistConfig,
    "enabled" | "callHandlingMode" | "businessHours" | "timezone"
  >,
  now: Date = new Date(),
): boolean {
  if (!config.enabled) return false;
  const mode: CallHandlingMode = config.callHandlingMode ?? "always";
  if (mode === "disabled") return false;
  // Overflow: AI answers when telephony forwards unanswered calls (Task 4).
  // Until live routing exists, treat overflow like always-on for activated lines.
  if (mode === "always" || mode === "overflow") return true;
  const afterHours = isAfterHours(config, now);
  if (mode === "business_hours") return !afterHours;
  if (mode === "after_hours") return afterHours;
  return true;
}

export function callHandlingLabel(
  mode: CallHandlingMode,
  locale: "en" | "fr" = "en",
): string {
  const fr = locale === "fr";
  switch (mode) {
    case "always":
      return fr ? "Toujours actif" : "Always active";
    case "business_hours":
      return fr ? "Heures d'ouverture seulement" : "Business hours only";
    case "after_hours":
      return fr ? "Hors des heures seulement" : "After hours only";
    case "overflow":
      return fr ? "Débordement / sans réponse" : "Overflow / no answer";
    case "disabled":
      return fr ? "Désactivé" : "Disabled";
  }
}
