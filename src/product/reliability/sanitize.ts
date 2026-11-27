import { redactDiagnostic } from "./types";

/**
 * Nothing that leaves the monitoring system may carry a secret, payment data,
 * a call transcript or customer contact details (KAN-28). Alerts are built
 * from enums, counts and identifiers, so this is the second line of defence:
 * every string is scrubbed, and the final payload is checked again and refused
 * outright (never sent "mostly clean") if something sensitive survived.
 */

export function sanitizeAlertText(value: string, max = 200): string {
  return redactDiagnostic(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export class UnsafeAlertPayloadError extends Error {
  constructor() {
    super("Alert payload contained sensitive data and was refused.");
    this.name = "UnsafeAlertPayloadError";
  }
}

/** Throws when any string in the payload still looks sensitive. */
export function assertAlertSafe(payload: unknown): void {
  const stack: unknown[] = [payload];
  while (stack.length) {
    const item = stack.pop();
    if (typeof item === "string") {
      if (sanitizeAlertText(item, item.length + 1) !== item.replace(/\s+/g, " ").trim())
        throw new UnsafeAlertPayloadError();
    } else if (Array.isArray(item)) stack.push(...item);
    else if (item && typeof item === "object") stack.push(...Object.values(item));
  }
}
