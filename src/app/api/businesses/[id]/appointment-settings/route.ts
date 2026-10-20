import { NextRequest, NextResponse } from "next/server";
import { putAppointmentSettings } from "@/product/receptionist/ai-receptionist-service";
import {
  bookSimulatedAppointment,
  checkSimulatedAvailability,
  listSimulatedAppointments,
} from "@/product/receptionist/appointment-sim";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { authorizeBusinessMemberOrAdmin, loadClientForOrg } from "../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const profile = await getReceptionistRuntime().profileStore.getProfile(id);
  const settings =
    profile?.settings.appointmentSettings ??
    defaultProfileSettings().appointmentSettings;
  return NextResponse.json({
    ok: true,
    appointmentSettings: settings,
    simulatedBookings: listSimulatedAppointments(id),
  });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json(
      { error: "Phone client is not linked." },
      { status: 409 },
    );
  }

  let body: {
    appointmentSettings?: unknown;
    /** Optional simulated booking probe (never contacts a real calendar). */
    probe?: {
      startIso: string;
      book?: boolean;
      customerName?: string;
      service?: string;
    };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const runtime = getReceptionistRuntime();
  if (body.appointmentSettings !== undefined) {
    const result = await putAppointmentSettings(runtime.profileStore, {
      organizationId: id,
      client,
      role: access.role,
      userEmail: access.userEmail,
      appointmentSettings: body.appointmentSettings,
    });
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }
    await runtime.refresh(true);
  }

  const profile = await runtime.profileStore.getProfile(id);
  const appt =
    profile?.settings.appointmentSettings ??
    defaultProfileSettings().appointmentSettings;

  let probeResult: unknown = null;
  if (body.probe?.startIso) {
    const common = {
      organizationId: id,
      startIso: body.probe.startIso,
      durationMinutes: appt.durationMinutes,
      bufferMinutes: appt.bufferMinutes,
      bookingNoticeHours: appt.bookingNoticeHours,
      maxDailyBookings: appt.maxDailyBookings,
    };
    if (body.probe.book) {
      probeResult = bookSimulatedAppointment({
        ...common,
        service: body.probe.service,
        customerName: body.probe.customerName,
      });
    } else {
      probeResult = checkSimulatedAvailability(common);
    }
  }

  return NextResponse.json({
    ok: true,
    appointmentSettings: appt,
    probe: probeResult,
    simulatedBookings: listSimulatedAppointments(id),
    updatedAt: profile?.updatedAt ?? null,
  });
}
