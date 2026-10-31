import { NextRequest } from "next/server";
import {
  handleAgentRequest,
  reportSchema,
} from "@/product/receptionist/agent-api";

export const dynamic = "force-dynamic";

/**
 * Ops-only: the voice agent's finished call. It becomes a normal receptionist
 * call record, so the owner gets the same summary, SMS/email, CRM sync and
 * missed-call recovery as for any other call. Repeating it is harmless.
 */
export async function POST(request: NextRequest) {
  return handleAgentRequest(
    request,
    "report",
    reportSchema,
    async ({ config, body, runtime }) => {
      const session = await runtime.agentCalls.report(config, {
        callId: body.callId,
        fromE164: body.from,
        language: body.language,
        intent: body.intent,
        slots: body.slots,
        transcript: body.transcript,
        transfer: body.transfer,
        emergency: body.emergency,
        durationSeconds: body.durationSeconds,
        endReason: body.endReason,
      });
      return {
        recorded: Boolean(session),
        outcome: session?.outcome ?? null,
        notified: session
          ? session.notifications.filter((n) => n.ok).length
          : 0,
      };
    },
  );
}
