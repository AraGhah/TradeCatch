import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { calcomAllowed } from "@/product/scheduling/availability";
import { connectCalcom } from "@/product/scheduling/calcom/connection";
import { toPublicConnection } from "@/product/scheduling/calcom/types";
import {
  getSchedulingService,
  getSchedulingStore,
} from "@/product/scheduling/runtime";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const connectSchema = z
  .object({
    apiKey: z.string().trim().min(10).max(250),
    eventTypes: z
      .array(
        z
          .object({
            eventTypeId: z.number().int().positive(),
            serviceId: z.string().trim().min(1).max(100).optional(),
            technicianId: z.string().trim().min(1).max(100).optional(),
            lengthInMinutes: z
              .number()
              .int()
              .min(5)
              .max(24 * 60)
              .optional(),
            addressAsLocation: z.boolean().optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    fallbackAttendeeEmail: z.string().trim().email().max(254).optional(),
    language: z.enum(["fr", "en"]).optional(),
  })
  .strict();

const DENIED = {
  error:
    "Cal.com is available only on the Professional plan, once it has been switched on for your business.",
  code: "calcom_not_enabled",
};

/** Connection status. Never returns the API key. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const row = await getSchedulingStore().getCalcomConnection(id);
  return NextResponse.json({
    ok: true,
    connection: row ? toPublicConnection(row) : null,
  });
}

/** Connects (or reconnects) the business's Cal.com account. */
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  if (!calcomAllowed(await getSaasStore().getOrganization(id))) {
    return NextResponse.json(DENIED, { status: 403 });
  }
  const read = await readJsonBody(request, 16 * 1024);
  if (!read.ok) {
    return NextResponse.json({ error: read.error }, { status: read.status });
  }
  const parsed = connectSchema.safeParse(read.data);
  if (!parsed.success) {
    // Field names only: the body holds the API key.
    return NextResponse.json(
      {
        error: "Invalid request.",
        fields: Array.from(
          new Set(parsed.error.issues.map((i) => i.path.join("."))),
        ),
      },
      { status: 400 },
    );
  }
  const result = await connectCalcom(
    { store: getSchedulingStore(), service: getSchedulingService() },
    { organizationId: id, ...parsed.data },
  );
  if (!result.ok) {
    const status =
      result.code === "calcom_unreachable"
        ? 502
        : result.code === "key_rejected"
          ? 422
          : 400;
    return NextResponse.json(
      { error: "Could not connect Cal.com.", code: result.code },
      { status },
    );
  }
  return NextResponse.json({
    ok: true,
    connection: result.connection,
    available: result.available,
  });
}

/** Disconnects Cal.com and deletes the stored key. Existing bookings stay in Cal.com. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const service = getSchedulingService();
  const rules = await service.getRules(id);
  if (rules.calendarMode === "calcom") {
    await service.disconnect(id);
  } else {
    await getSchedulingStore().deleteCalcomConnection(id);
  }
  return NextResponse.json({
    ok: true,
    calendar: await service.connectionStatus(id),
  });
}
