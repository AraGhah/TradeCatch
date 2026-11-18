import { NextResponse } from "next/server";
import { safeErrorResponse } from "@/lib/api-error";
import { enforcePolicy } from "@/lib/rate-limit-response";
import { AutomationError } from "./service";

/**
 * Answers for the automation routes: every failure reaches the screen as JSON with a
 * message it can show, never as an empty 500 it cannot read.
 *  - A refused setting (AutomationError) says what was refused, and which settings.
 *  - Anything else (a database error) keeps its detail in the server log and the error
 *    monitor, and gives the screen a plain sentence and a request id for support.
 */
export async function automationFailure(
  err: unknown,
  route: string,
): Promise<NextResponse> {
  if (err instanceof AutomationError) {
    return NextResponse.json(
      {
        error: err.message,
        ...(err.fields.length > 0 ? { fields: err.fields } : {}),
      },
      { status: err.status },
    );
  }
  return safeErrorResponse(err, {
    route: `automations.${route}`,
    fallback:
      "This could not be saved right now. Reload the page to see the current state.",
  });
}

/** Changes that turn customer texts on or off, or reword them, share one bucket per person. */
export function limitAutomationWrite(organizationId: string, userId: string) {
  return enforcePolicy("sensitive.automation-settings", {
    subject: `${organizationId}:${userId}`,
  });
}
