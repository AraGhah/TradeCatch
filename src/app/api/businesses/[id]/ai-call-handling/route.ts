import { NextRequest, NextResponse } from "next/server";
import { allows } from "@/product/security/permissions";
import { voiceCapabilitiesForPlan } from "@/product/receptionist/plan-limits";
import {
  defaultProfileSettings,
  validateProfile,
  type ProfileSettings,
  type ReceptionistProfile,
} from "@/product/receptionist/profile";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import type { PlanId } from "@/product/saas/entitlements";
import {
  aiCallHandlingUpdateSchema,
  applyAiCallHandlingUpdate,
  buildAiCallHandlingView,
  observeTestCall,
} from "@/product/telephony/ai-call-handling-service";
import { livekitHandoffReady } from "@/product/telephony/livekit-handoff";
import { checkNumberRouting } from "@/product/telephony/number-routing-check";
import { parsePhoneSettings } from "@/product/telephony/phone-settings";
import type { PhoneSettings } from "@/product/telephony/types";
import { authorizeBusinessMemberOrAdmin, loadClientForOrg } from "../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * AI Call Handling: Missed Calls Only / AI Answers All Calls, the
 * personal-contacts list, and the test call that verifies the routing.
 *
 * GET   the requested mode, effective mode and setup status.
 * PUT   save the mode and contacts (owner/admin; plans with voice only).
 * POST  { action: "start_test" | "check_test" | "check_number" }.
 *
 * Nothing here changes Twilio, the SIP trunk or carrier forwarding: the
 * number check is a read-only lookup.
 */

function transferTargets(settings: ProfileSettings): (string | undefined)[] {
  return [
    settings.emergencyTransferE164,
    settings.fallbackTransferE164,
    settings.transferSettings?.primaryTransferE164,
    settings.transferSettings?.secondaryTransferE164,
    settings.phoneSettings?.humanTransferE164,
    settings.phoneSettings?.backupTransferE164,
    ...settings.routing.map((r) => r.phoneE164),
  ];
}

function viewFor(input: {
  plan: PlanId | undefined;
  profile: ReceptionistProfile | null;
  settings: ProfileSettings;
  phone: PhoneSettings;
  canEdit: boolean;
}) {
  return buildAiCallHandlingView({
    plan: input.plan,
    activated: input.profile?.activated ?? false,
    tradecatchNumberE164:
      input.phone.tradecatchNumberE164 || input.profile?.phoneNumberE164,
    phone: input.phone,
    canEdit: input.canEdit,
    livekitHandoffReady: livekitHandoffReady(),
    transferTargets: transferTargets(input.settings),
  });
}

async function persistPhone(
  organizationId: string,
  profile: ReceptionistProfile | null,
  settings: ProfileSettings,
  phone: PhoneSettings,
  actor: string,
) {
  const runtime = getReceptionistRuntime();
  const next = { ...settings, phoneSettings: phone };
  await runtime.profileStore.saveSettings(organizationId, next, actor);
  await runtime.refresh(true);
  return next;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const runtime = getReceptionistRuntime();
  const profile = await runtime.profileStore.getProfile(id);
  const settings = profile?.settings ?? defaultProfileSettings();
  const phone = parsePhoneSettings(settings.phoneSettings);
  const canEdit = allows(
    access.role,
    "manage_settings",
    access.via === "admin",
  );
  return NextResponse.json({
    ok: true,
    aiCallHandling: viewFor({
      plan: access.organization.plan,
      profile,
      settings,
      phone,
      canEdit,
    }),
  });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;
  if (!allows(access.role, "manage_settings", access.via === "admin")) {
    return NextResponse.json(
      {
        error: "Only an owner or admin can change call handling.",
        code: "forbidden",
      },
      { status: 403 },
    );
  }
  const plan = access.organization.plan;
  if (!plan || !voiceCapabilitiesForPlan(plan).voice) {
    return NextResponse.json(
      {
        error: "Your plan does not include the phone receptionist.",
        code: "plan_upgrade_required",
        feature: "AI_RECEPTIONIST_VOICE",
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON.", code: "invalid_json" },
      { status: 400 },
    );
  }
  const parsed = aiCallHandlingUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid call handling settings.",
        code: "invalid",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          code: "invalid",
        })),
      },
      { status: 400 },
    );
  }

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json(
      { error: "Phone client is not linked.", code: "client_not_linked" },
      { status: 409 },
    );
  }

  const runtime = getReceptionistRuntime();
  const profile = await runtime.profileStore.getProfile(id);
  const settings = profile?.settings ?? defaultProfileSettings();
  const previous = parsePhoneSettings(settings.phoneSettings);
  const tradecatch = previous.tradecatchNumberE164 || profile?.phoneNumberE164;
  const applied = applyAiCallHandlingUpdate({
    previous,
    update: parsed.data,
    tradecatchNumberE164: tradecatch,
    now: new Date(),
  });
  if (!applied.ok) {
    return NextResponse.json(
      {
        error: "Invalid call handling settings.",
        code: "invalid",
        issues: applied.issues,
      },
      { status: 400 },
    );
  }

  // The same save-time checks as every other receptionist setting, so a
  // save can never leave a live line with a config that fails to build.
  const nextSettings = { ...settings, phoneSettings: applied.phone };
  const checked = validateProfile(
    {
      organizationId: id,
      phoneNumberE164: profile?.phoneNumberE164,
      activated: profile?.activated ?? false,
      settings: nextSettings,
      updatedAt: new Date().toISOString(),
    },
    { client, capabilities: voiceCapabilitiesForPlan(plan) },
  );
  if (!checked.ok) {
    return NextResponse.json(
      {
        error: "Invalid call handling settings.",
        code: "invalid",
        issues: checked.issues.map((i) => ({
          field: i.field,
          code: "invalid",
        })),
      },
      { status: 400 },
    );
  }

  const saved = await persistPhone(
    id,
    profile,
    settings,
    applied.phone,
    access.userEmail,
  );
  return NextResponse.json({
    ok: true,
    routingChanged: applied.routingChanged,
    aiCallHandling: viewFor({
      plan,
      profile: await runtime.profileStore.getProfile(id),
      settings: saved,
      phone: applied.phone,
      canEdit: true,
    }),
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;
  if (!allows(access.role, "manage_settings", access.via === "admin")) {
    return NextResponse.json(
      {
        error: "Only an owner or admin can test call handling.",
        code: "forbidden",
      },
      { status: 403 },
    );
  }
  let action: unknown;
  try {
    action = ((await request.json()) as { action?: unknown })?.action;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON.", code: "invalid_json" },
      { status: 400 },
    );
  }
  if (
    action !== "start_test" &&
    action !== "check_test" &&
    action !== "check_number"
  ) {
    return NextResponse.json(
      { error: "Unknown action.", code: "invalid" },
      { status: 400 },
    );
  }

  const plan = access.organization.plan;
  const runtime = getReceptionistRuntime();
  const profile = await runtime.profileStore.getProfile(id);
  const settings = profile?.settings ?? defaultProfileSettings();
  let phone = parsePhoneSettings(settings.phoneSettings);
  const tradecatch = phone.tradecatchNumberE164 || profile?.phoneNumberE164;
  const now = new Date();
  let test: ReturnType<typeof observeTestCall> | undefined;

  if (action === "start_test") {
    if (!plan || !voiceCapabilitiesForPlan(plan).voice) {
      return NextResponse.json(
        {
          error: "Your plan does not include the phone receptionist.",
          code: "plan_upgrade_required",
        },
        { status: 403 },
      );
    }
    phone = { ...phone, routingTestStartedAt: now.toISOString() };
    await persistPhone(id, profile, settings, phone, access.userEmail);
  } else if (action === "check_test") {
    const client = await loadClientForOrg(access.organization);
    const view = viewFor({ plan, profile, settings, phone, canEdit: true });
    const sessions = client
      ? await runtime.store.listSessions({
          clientAccountId: client.id,
          limit: 25,
        })
      : [];
    test = observeTestCall({ phone, mode: view.requestedMode, sessions, now });
    if (test.status === "verified") {
      phone = {
        ...phone,
        routingVerification: test.verification,
        routingTestStartedAt: undefined,
      };
      await persistPhone(id, profile, settings, phone, access.userEmail);
    }
  } else {
    const result = tradecatch
      ? await checkNumberRouting(tradecatch)
      : "unknown";
    phone = {
      ...phone,
      numberRoutingCheck: { result, checkedAt: now.toISOString() },
    };
    await persistPhone(id, profile, settings, phone, access.userEmail);
  }

  const latest = await runtime.profileStore.getProfile(id);
  return NextResponse.json({
    ok: true,
    ...(test ? { test } : {}),
    aiCallHandling: viewFor({
      plan,
      profile: latest,
      settings: latest?.settings ?? settings,
      phone,
      canEdit: true,
    }),
  });
}
