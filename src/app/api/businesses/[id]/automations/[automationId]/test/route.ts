import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit-response";
import { z } from "zod";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import { AutomationError } from "@/product/sms-automation/service";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; automationId: string }> };

const schema = z.object({
  action: z.enum([
    "simulate_missed_call",
    "simulate_quote",
    "simulate_reply",
    "run_next",
    "accept_quote",
    "reject_quote",
    "live_self",
  ]),
  phoneE164: z.string().trim().min(8).max(20).optional(),
  customerName: z.string().trim().max(120).optional(),
  body: z.string().trim().max(500).optional(),
  quoteRef: z.string().trim().max(80).optional(),
  locale: z.enum(["en", "fr"]).optional(),
  serviceName: z.string().trim().max(80).optional(),
  threadId: z.string().trim().min(1).max(80).optional(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id, automationId } = await params;
  const access = await requireAutomationAccess(id, "write");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  const limited = await enforceRateLimit({
    scope: "automation-test",
    subject: `${id}:${access.ctx.user.id}`,
    limit: 30,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid test request." },
      { status: 400 },
    );
  }
  if (parsed.data.action === "live_self") {
    // The only action here that sends a real, billed text message.
    const liveLimited = await enforceRateLimit({
      scope: "automation-live-sms",
      subject: `${id}:${access.ctx.user.id}`,
      limit: 5,
      windowMs: 60 * 60_000,
    });
    if (liveLimited) return liveLimited;
  }
  const services = getAutomationServices();
  const automations = await services.list(id);
  const automation = automations.find((row) => row.id === automationId);
  if (!automation || automation.organizationId !== id) {
    return NextResponse.json(
      { error: "Automation not found." },
      { status: 404 },
    );
  }
  try {
    const action = parsed.data.action;
    if (action === "simulate_missed_call") {
      if (automation.type !== "missed_call_recovery") {
        return NextResponse.json(
          { error: "Wrong automation." },
          { status: 409 },
        );
      }
      const result = await services.simulateMissedCall({
        organizationId: id,
        phoneE164: parsed.data.phoneE164 || "+15145550100",
        customerName: parsed.data.customerName || "Alex Martin",
        language: parsed.data.locale,
        serviceName: parsed.data.serviceName,
      });
      return NextResponse.json({ ok: true, simulated: true, ...result });
    }
    if (action === "simulate_quote") {
      if (automation.type !== "quote_followup") {
        return NextResponse.json(
          { error: "Wrong automation." },
          { status: 409 },
        );
      }
      const result = await services.simulateQuote({
        organizationId: id,
        phoneE164: parsed.data.phoneE164 || "+15145550100",
        customerName: parsed.data.customerName || "John Smith",
        quoteRef: parsed.data.quoteRef || "Q-1200",
        locale: parsed.data.locale,
        serviceName: parsed.data.serviceName || "water heater repair",
      });
      return NextResponse.json({ ok: true, simulated: true, ...result });
    }
    if (action === "simulate_reply") {
      const result = await services.applyInbound({
        organizationId: id,
        fromE164: parsed.data.phoneE164 || "+15145550100",
        body: parsed.data.body || "I need a plumber tomorrow.",
        messageSid: `sim_${Date.now()}`,
        simulated: true,
        customerName: parsed.data.customerName,
      });
      return NextResponse.json({ ok: true, simulated: true, ...result });
    }
    if (action === "run_next") {
      const result = await services.runNextSimulated(id);
      return NextResponse.json({ ok: true, simulated: true, ...result });
    }
    if (action === "accept_quote" || action === "reject_quote") {
      if (!parsed.data.threadId) {
        return NextResponse.json(
          { error: "threadId is required." },
          { status: 400 },
        );
      }
      const canceled = await services.setQuoteOutcome(
        id,
        parsed.data.threadId,
        action === "accept_quote" ? "accepted" : "rejected",
      );
      return NextResponse.json({ ok: true, canceled });
    }
    const result = await services.sendLiveTest({ organizationId: id });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AutomationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
