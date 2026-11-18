import { NextResponse } from "next/server";
import { SchedulingError } from "./service";

/**
 * The one place a scheduling failure becomes an HTTP answer.
 *
 * A refusal the service understands (a taken time, a bad range, a missing
 * appointment) keeps its own status and a message the person can act on.
 * Anything else, such as the database being unreachable, is an outage: it is
 * reported as one (503) with no success flag and no calendar data, so the
 * screen can never show "saved" or "no appointments" for something that was
 * not. The cause is logged on the server and never sent to the browser.
 */
export function schedulingFailure(error: unknown, action: string) {
  if (error instanceof SchedulingError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error(
    `[scheduling] ${action} failed:`,
    error instanceof Error ? error.message : "unknown error",
  );
  return NextResponse.json(
    {
      ok: false,
      error:
        "The calendar is temporarily unavailable, so this was not completed. Please try again in a moment.",
      code: "service_unavailable",
    },
    { status: 503 },
  );
}

/**
 * The HTTP status for a service result that carries `ok: false`. A calendar
 * provider that could not be reached is a gateway problem, not the customer's
 * mistake; every other refusal is a conflict with the current state.
 */
export function refusalStatus(reason: string | undefined): number {
  return reason === "calendar_error" ? 502 : 409;
}
