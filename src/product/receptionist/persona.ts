/**
 * Who answers the phone. Kept free of imports so the settings form (a client
 * bundle), the greeting defaults and the LiveKit agent config all share it.
 *
 * A business can set its own receptionist name (`receptionistName`); until it
 * does, she is Lucie. The LiveKit agent applies the same default when an older
 * server sends no name (agents/receptionist/persona.py).
 */
export const DEFAULT_RECEPTIONIST_NAME = "Lucie";

/** The configured name, or Lucie. A blank name counts as not set. */
export function receptionistNameOrDefault(name?: string | null): string {
  return name?.trim() || DEFAULT_RECEPTIONIST_NAME;
}
