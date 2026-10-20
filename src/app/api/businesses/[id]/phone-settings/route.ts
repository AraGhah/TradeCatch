import { NextRequest, NextResponse } from "next/server";
import { allows } from "@/product/security/permissions";
import {
  buildPhoneSettingsView,
  parsePhoneSettings,
  phoneSettingsSchema,
} from "@/product/telephony/phone-settings";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { authorizeBusinessMemberOrAdmin, loadClientForOrg } from "../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const runtime = getReceptionistRuntime();
  const profile = await runtime.profileStore.getProfile(id);
  const settings = profile?.settings ?? defaultProfileSettings();
  const phone = parsePhoneSettings(settings.phoneSettings);

  return NextResponse.json({
    ok: true,
    phoneSettings: buildPhoneSettingsView({
      organizationId: id,
      activated: profile?.activated ?? false,
      profilePhoneE164: profile?.phoneNumberE164,
      callHandlingMode: settings.callHandlingMode,
      defaultLanguage: settings.defaultLanguage,
      businessHours: settings.businessHours,
      receptionistName: settings.receptionistName,
      phone,
    }),
  });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  if (!allows(access.role, "manage_settings", access.via === "admin")) {
    return NextResponse.json(
      { error: "Only an owner or admin can change phone settings." },
      { status: 403 },
    );
  }

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json(
      { error: "Phone client is not linked." },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = phoneSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid phone settings.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const runtime = getReceptionistRuntime();
  const existing = await runtime.profileStore.getProfile(id);
  const base = existing?.settings ?? defaultProfileSettings();
  const nextSettings = {
    ...base,
    phoneSettings: parsed.data,
    // Keep transfer numbers in sync with phone settings when provided.
    ...(parsed.data.humanTransferE164
      ? {
          fallbackTransferE164: parsed.data.humanTransferE164,
          transferSettings: {
            ...base.transferSettings,
            primaryTransferE164: parsed.data.humanTransferE164,
            secondaryTransferE164: parsed.data.backupTransferE164,
          },
        }
      : {}),
  };

  // If a TradeCatch number is set and profile has none, store it on activation fields carefully:
  // saveSettings does not change phoneNumberE164 — ops/owner activate still owns that.
  const saved = await runtime.profileStore.saveSettings(
    id,
    nextSettings,
    access.userEmail,
  );

  // Optional: when tradecatch number provided and profile inactive number empty, set via activation off.
  if (
    parsed.data.tradecatchNumberE164 &&
    !saved.phoneNumberE164 &&
    !saved.activated
  ) {
    try {
      await runtime.profileStore.setActivation(
        id,
        {
          phoneNumberE164: parsed.data.tradecatchNumberE164,
          activated: false,
        },
        access.userEmail,
      );
    } catch {
      // Number conflict — surface as disconnected/error on the view.
    }
  }

  await runtime.refresh(true);
  const profile = await runtime.profileStore.getProfile(id);
  const settings = profile?.settings ?? nextSettings;

  return NextResponse.json({
    ok: true,
    phoneSettings: buildPhoneSettingsView({
      organizationId: id,
      activated: profile?.activated ?? false,
      profilePhoneE164: profile?.phoneNumberE164,
      callHandlingMode: settings.callHandlingMode,
      defaultLanguage: settings.defaultLanguage,
      businessHours: settings.businessHours,
      receptionistName: settings.receptionistName,
      phone: parsePhoneSettings(settings.phoneSettings),
    }),
  });
}
