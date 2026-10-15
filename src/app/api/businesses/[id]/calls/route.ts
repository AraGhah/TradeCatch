import { NextRequest, NextResponse } from "next/server";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json({ ok: true, calls: [] });
  }

  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit")) || 50,
    200,
  );
  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase();
  const runtime = getReceptionistRuntime();
  let calls = await runtime.store.listSessions({
    clientAccountId: client.id,
    limit: 200,
  });

  if (q) {
    calls = calls.filter((c) => {
      const hay = [
        c.id,
        c.callSid,
        c.fromE164,
        c.outcome,
        c.summary?.callerName,
        c.summary?.issue,
        c.summary?.headline,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  calls = calls.slice(0, limit);

  return NextResponse.json({
    ok: true,
    calls: calls.map((c) => ({
      id: c.id,
      callSid: c.callSid,
      simulated:
        c.callSid.startsWith("sim_") || c.callSid.startsWith("demo_"),
      direction: "inbound" as const,
      fromE164: c.fromE164,
      toE164: c.toE164,
      language: c.language,
      status: c.status,
      outcome: c.outcome,
      handledBy:
        c.outcome === "transferred" || c.outcome === "emergency_transferred"
          ? "human"
          : "ai",
      transferStatus: c.transfers.at(-1)?.status ?? null,
      leadCreated: Boolean(c.summary?.callerName || c.slots.callerName),
      appointmentBooked: c.outcome === "appointment_requested",
      urgency: c.urgency?.level,
      afterHours: c.afterHours,
      summary: c.summary,
      slots: c.slots,
      durationSeconds: c.durationSeconds,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      finalizedAt: c.finalizedAt,
    })),
  });
}
