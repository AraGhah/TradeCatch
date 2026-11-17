/**
 * What each voice-agent tool does once the caller and the business are known.
 * The LiveKit routes (/api/receptionist/agent/*) and the Bland routes
 * (/api/bland/*) both call these, so the rules (who owns an appointment, what
 * counts as booked, how a call is recorded) exist once. Only the way the
 * request proves who is calling differs between the two.
 *
 * `requireLiveProvider` is the Bland rule: a time is offered, booked, moved or
 * canceled only when a real, connected calendar provider is behind it. The
 * simulated or internal calendar never confirms anything on a Bland call.
 */

import type { z } from "zod";
import type {
  appointmentActionSchema,
  availabilitySchema,
  bookSchema,
  detailsSchema,
  reportSchema,
} from "./agent-api";
import type { AgentChannel } from "./agent-calls";
import type { getReceptionistRuntime } from "./runtime";
import type { ReceptionistConfig } from "./types";

type Runtime = ReturnType<typeof getReceptionistRuntime>;

export type OperationContext<Body> = {
  config: ReceptionistConfig;
  body: Body;
  runtime: Runtime;
  channel?: AgentChannel;
  requireLiveProvider?: boolean;
};

const live = async (ctx: OperationContext<unknown>) =>
  !ctx.requireLiveProvider ||
  (await ctx.runtime.bookingProvider(ctx.config)) !== null;

export async function agentAvailability(
  ctx: OperationContext<z.infer<typeof availabilitySchema>>,
) {
  const { config, body, runtime } = ctx;
  if (!(await live(ctx))) {
    return { availability: { ok: false, reason: "booking_disabled" } };
  }
  // Moving an appointment: only the caller who owns it gets times, for its own service.
  let existing: {
    serviceId?: string;
    serviceAddress?: string;
    serviceName: string;
  } | null = null;
  if (body.appointmentId) {
    existing = await runtime.agentAppointments.forRescheduling(config, {
      callerE164: body.from,
      callerName: body.callerName,
      appointmentId: body.appointmentId,
    });
    if (!existing) return { availability: { ok: false, reason: "not_bookable" } };
  }
  return {
    availability: await runtime.agentCalls.availability(config, {
      callId: body.callId,
      channel: ctx.channel,
      fromE164: body.from,
      language: body.language,
      preferredTime: body.preferredTime,
      issue: existing ? existing.serviceName : body.issue,
      serviceAddress: existing ? existing.serviceAddress : body.serviceAddress,
      serviceId: existing?.serviceId,
      rescheduling: Boolean(existing),
    }),
  };
}

export async function agentBook(ctx: OperationContext<z.infer<typeof bookSchema>>) {
  const { config, body, runtime } = ctx;
  if (!(await live(ctx))) {
    return { booking: { status: "request", reason: "booking_disabled" } };
  }
  return {
    booking: await runtime.agentCalls.book(config, {
      callId: body.callId,
      channel: ctx.channel,
      fromE164: body.from,
      language: body.language,
      startAt: body.startAt,
      serviceId: body.serviceId,
      serviceName: body.serviceName,
      timezone: body.timezone,
      callerName: body.callerName,
      callbackE164: body.callbackE164,
      serviceAddress: body.serviceAddress,
    }),
  };
}

export async function agentAppointments(
  ctx: OperationContext<z.infer<typeof appointmentActionSchema>>,
) {
  const { config, body, runtime } = ctx;
  const service = runtime.agentAppointments;
  const caller = { callerE164: body.from, callerName: body.callerName };
  switch (body.action) {
    case "find":
      return {
        result: await service.find(config, { ...caller, language: body.language }),
      };
    case "move":
      if (!(await live(ctx))) return { result: { status: "disabled" } };
      return {
        result: await service.move(config, {
          ...caller,
          appointmentId: body.appointmentId,
          startAt: body.startAt,
          language: body.language,
        }),
      };
    case "cancel":
      if (!(await live(ctx))) return { result: { status: "disabled" } };
      return {
        result: await service.cancel(config, {
          ...caller,
          appointmentId: body.appointmentId,
        }),
      };
    case "text":
      return {
        result: await service.text(config, {
          ...caller,
          callId: body.callId,
          language: body.language,
          kind: body.kind,
          appointmentId: body.appointmentId,
        }),
      };
  }
}

export async function agentDetails(
  ctx: OperationContext<z.infer<typeof detailsSchema>>,
) {
  const { config, body, runtime } = ctx;
  return {
    result: await runtime.agentCalls.saveDetails(config, {
      callId: body.callId,
      channel: ctx.channel,
      fromE164: body.from,
      language: body.language,
      slots: body.slots,
    }),
  };
}

export async function agentReport(
  ctx: OperationContext<z.infer<typeof reportSchema>>,
) {
  const { config, body, runtime } = ctx;
  const session = await runtime.agentCalls.report(config, {
    callId: body.callId,
    channel: ctx.channel,
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
    notified: session ? session.notifications.filter((n) => n.ok).length : 0,
  };
}
