import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { buildAgentConfig } from "@/product/receptionist/agent-config";
import { logReceptionistDiagnostic } from "@/product/receptionist/diagnostics";
import { inactiveLineNotice } from "@/product/receptionist/inactive-line";
import { resolveAgentVoice } from "@/product/receptionist/custom-voice/agent-voice";
import { getVoiceService } from "@/product/receptionist/custom-voice/runtime";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import {
  callerPolicyFor,
  personalCallMessage,
} from "@/product/telephony/caller-policy";

export const dynamic = "force-dynamic";

const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

/**
 * Ops-only: the realtime voice agent asks, per call, how to answer the number
 * that was dialed. Returns the business's rendered instructions and its
 * validated transfer lines, and which voice to speak with (the standard voice,
 * or the business's own cloned voice on Receptionist Plus). Bearer ops auth +
 * X-Ops-Actor in production.
 */
export async function GET(request: NextRequest) {
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "receptionist.agent_config");
  if (audit.missingActor) return missingOpsActorResponse();

  const number = request.nextUrl.searchParams.get("number")?.trim() ?? "";
  if (digits(number).length < 10) {
    return NextResponse.json(
      { error: "Query parameter 'number' (E.164) is required." },
      { status: 400 },
    );
  }

  const runtime = getReceptionistRuntime();
  await runtime.refresh(false);
  // Exact number match only: an unknown number must never be answered as some
  // other business.
  const config = runtime.configs.find(
    (c) => c.enabled && digits(c.phoneNumberE164) === digits(number),
  );

  // The cached profile set can be ~30 s old on this instance. A business that
  // just switched its receptionist off must not have it answer another call,
  // so a tenant line is confirmed against the database on every call.
  const stillOn = config ? await runtime.confirmLineActive(config) : false;
  if (!config || !stillOn) {
    const off =
      (await runtime.describeInactiveLine(number)) ??
      // The line was loaded but its profile is gone or off: still not answered.
      (config
        ? {
            reason: "deactivated" as const,
            notice: inactiveLineNotice({
              businessName: config.businessName,
              languages: config.languages,
              defaultLanguage: config.defaultLanguage,
            }),
          }
        : null);
    if (off) {
      logReceptionistDiagnostic({
        event: "inactive_line_answered",
        code: off.reason,
        dialedNumber: number,
      });
      // 200, not 404: the line is known and the answer is "do not converse".
      // `config` is deliberately absent, so an agent that predates this field
      // keeps its old behaviour instead of failing on a half-built config.
      return NextResponse.json({
        ok: true,
        answering: false,
        reason: off.reason,
        callerPolicy: {
          kind: "receptionist_off",
          messages: off.notice.map((line) => ({
            lang: line.lang,
            text: line.text,
          })),
        },
      });
    }
  }
  if (!config) {
    return NextResponse.json(
      { error: "No active receptionist for that number." },
      { status: 404 },
    );
  }
  // The cloned voice (Receptionist Plus), or the standard voice whenever it is
  // not entitled, not activated, revoked, or anything at all goes wrong.
  const voice = await resolveAgentVoice(config.id, {
    getOrganization: (id) => getSaasStore().getOrganization(id),
    voices: getVoiceService(),
  });
  // With `from` (the agent sends "anonymous" for a withheld caller ID), the
  // owner's personal-contacts policy is decided here. Only this call's
  // decision goes back; the list never leaves the server.
  const from = request.nextUrl.searchParams.get("from");
  const policy =
    from === null ? null : callerPolicyFor(config, from.slice(0, 32));
  const callerPolicy =
    !policy || policy.kind === "ai"
      ? undefined
      : {
          kind: policy.kind,
          messages:
            policy.kind === "personal_end"
              ? []
              : personalCallMessage(
                  config,
                  policy.kind === "unknown_message" ? "unknown" : "personal",
                ),
          ...(policy.kind === "personal_transfer"
            ? { transferE164: policy.transferE164 }
            : {}),
        };
  return NextResponse.json({
    ok: true,
    config: {
      ...buildAgentConfig(config, new Date(), voice),
      ...(callerPolicy ? { callerPolicy } : {}),
    },
  });
}
