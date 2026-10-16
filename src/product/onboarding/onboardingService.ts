import { newId } from "@/product/saas/ids";
import type { PlanId } from "@/product/saas/entitlements";
import { orgHasFeature } from "@/product/saas/entitlements";
import type { Organization } from "@/product/saas/types";
import { getSaasStore } from "@/product/saas/runtime";
import { getGrowthStore } from "@/product/growth";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import {
  defaultProfileSettings,
  knowledgeSchema,
} from "@/product/receptionist/profile";
import { saveOwnerSettings } from "@/product/receptionist/profile-service";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { runSimulatedPhoneScenario } from "@/product/telephony/live-test";
import { getSchedulingService } from "@/product/scheduling/runtime";
import {
  buildActivationChecks,
  probeIntegrations,
} from "./integrationReadiness";
import { requirementsForPlan } from "./requirements";
import type { OnboardingStore } from "./store";
import type {
  OnboardingSession,
  OnboardingSnapshot,
  OnboardingStepId,
  OnboardingStepRecord,
  ReadinessReport,
  StepStatus,
  VerificationKind,
} from "./types";
import { ONBOARDING_STEP_IDS } from "./types";

function nowIso(now: () => Date) {
  return now().toISOString();
}

function emptySteps(
  businessId: string,
  plan: PlanId,
  at: string,
): OnboardingStepRecord[] {
  const reqs = requirementsForPlan(plan);
  return reqs.map((r) => ({
    businessId,
    stepId: r.stepId,
    status: "not_started" as StepStatus,
    required: r.required,
    payload: {},
    lastError: null,
    completedAt: null,
    verifiedAt: null,
    updatedAt: at,
  }));
}

export function createOnboardingService(deps: {
  store: OnboardingStore;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function ensureSession(
    organization: Organization,
  ): Promise<OnboardingSession> {
    const existing = await deps.store.getSession(organization.id);
    if (existing) {
      if (existing.plan !== organization.plan) {
        const updated = {
          ...existing,
          plan: organization.plan,
          updatedAt: nowIso(now),
        };
        await deps.store.saveSession(updated);
        const reqs = requirementsForPlan(organization.plan);
        for (const r of reqs) {
          const step = await deps.store.getStep(organization.id, r.stepId);
          if (step) {
            await deps.store.saveStep({
              ...step,
              required: r.required,
              updatedAt: nowIso(now),
            });
          }
        }
        return updated;
      }
      return existing;
    }

    const at = nowIso(now);
    const session: OnboardingSession = {
      id: newId("onb"),
      businessId: organization.id,
      status: "not_started",
      currentStep: "account",
      plan: organization.plan,
      draft: {},
      activatedAt: null,
      deactivatedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    await deps.store.saveSession(session);
    for (const step of emptySteps(organization.id, organization.plan, at)) {
      await deps.store.saveStep(step);
    }
    return session;
  }

  async function audit(
    businessId: string,
    action: string,
    detail: Record<string, unknown>,
    actorUserId?: string | null,
  ) {
    await deps.store.addEvent({
      id: newId("onbev"),
      businessId,
      actorUserId: actorUserId ?? null,
      action,
      detail,
      createdAt: nowIso(now),
    });
  }

  async function computeReadiness(
    organization: Organization,
  ): Promise<ReadinessReport> {
    const session = await ensureSession(organization);
    const live = await probeIntegrations(organization);
    const phoneVer = await deps.store.getVerification(organization.id, "phone");
    const callVer = await deps.store.getVerification(
      organization.id,
      "test_call",
    );
    const phoneVerified = phoneVer?.status === "passed";
    const liveCallVerified = callVer?.status === "passed";

    const checks = buildActivationChecks({
      businessId: organization.id,
      plan: organization.plan,
      live: {
        ...live,
        phoneVerified,
        liveCallVerified: live.liveCallVerified || liveCallVerified,
      },
      phoneVerified,
      liveCallVerified: live.liveCallVerified || liveCallVerified,
      nowIso: nowIso(now),
    });

    for (const check of checks) {
      await deps.store.saveActivationCheck(check);
    }

    const blockingReasons = checks
      .filter((c) => c.blocking && !c.passed)
      .map((c) => c.detail || c.label);

    const canActivate = blockingReasons.length === 0;
    let status = session.status;
    if (session.activatedAt && !session.deactivatedAt) {
      status = "active";
    } else if (canActivate) {
      status = "ready";
    } else if (blockingReasons.length > 0 && session.status !== "not_started") {
      status = "needs_action";
    }

    if (status !== session.status) {
      await deps.store.saveSession({
        ...session,
        status,
        updatedAt: nowIso(now),
      });
    }

    return {
      businessId: organization.id,
      status,
      plan: organization.plan,
      canActivate,
      blockingReasons,
      checks,
      steps: await deps.store.listSteps(organization.id),
      verifications: await deps.store.listVerifications(organization.id),
      activatedAt: session.activatedAt,
    };
  }

  async function getSnapshot(
    organization: Organization,
  ): Promise<OnboardingSnapshot> {
    const session = await ensureSession(organization);
    const readiness = await computeReadiness(organization);
    return {
      session: (await deps.store.getSession(organization.id)) ?? session,
      steps: await deps.store.listSteps(organization.id),
      requirements: requirementsForPlan(organization.plan),
      readiness,
    };
  }

  async function markStep(
    businessId: string,
    stepId: OnboardingStepId,
    patch: Partial<OnboardingStepRecord>,
  ) {
    const existing = await deps.store.getStep(businessId, stepId);
    const at = nowIso(now);
    const row: OnboardingStepRecord = {
      businessId,
      stepId,
      status: patch.status ?? existing?.status ?? "in_progress",
      required: patch.required ?? existing?.required ?? true,
      payload: patch.payload ?? existing?.payload ?? {},
      lastError: patch.lastError === undefined ? existing?.lastError ?? null : patch.lastError,
      completedAt:
        patch.completedAt === undefined
          ? existing?.completedAt ?? null
          : patch.completedAt,
      verifiedAt:
        patch.verifiedAt === undefined
          ? existing?.verifiedAt ?? null
          : patch.verifiedAt,
      updatedAt: at,
    };
    await deps.store.saveStep(row);
    return row;
  }

  return {
    getSnapshot,
    computeReadiness,
    ensureSession,

    async saveStep(input: {
      organization: Organization;
      stepId: OnboardingStepId;
      payload: Record<string, unknown>;
      skip?: boolean;
      actorUserId?: string | null;
    }) {
      const session = await ensureSession(input.organization);
      const req = requirementsForPlan(input.organization.plan).find(
        (r) => r.stepId === input.stepId,
      );
      if (req?.required === false && input.skip) {
        await markStep(input.organization.id, input.stepId, {
          status: "skipped",
          required: false,
          payload: input.payload,
          completedAt: nowIso(now),
        });
        await audit(
          input.organization.id,
          "step_skipped",
          { stepId: input.stepId },
          input.actorUserId,
        );
        const next = nextStep(input.stepId);
        await deps.store.saveSession({
          ...session,
          status: "in_progress",
          currentStep: next,
          draft: { ...session.draft, [input.stepId]: input.payload },
          updatedAt: nowIso(now),
        });
        return {
          ok: true as const,
          snapshot: await getSnapshot(input.organization),
        };
      }

      const applied = await applyStepPayload(input);
      if (!applied.ok) {
        await markStep(input.organization.id, input.stepId, {
          status: "failed",
          lastError: applied.error,
          payload: input.payload,
        });
        return {
          ok: false as const,
          error: applied.error,
          status: applied.status ?? 400,
          snapshot: await getSnapshot(input.organization),
        };
      }

      const needsVerify = applied.needsVerification;
      await markStep(input.organization.id, input.stepId, {
        status: needsVerify ? "needs_verification" : "completed",
        payload: input.payload,
        completedAt: needsVerify ? null : nowIso(now),
        lastError: null,
        required: req?.required ?? true,
      });

      const next = nextStep(input.stepId);
      await deps.store.saveSession({
        ...session,
        status: "in_progress",
        currentStep: next,
        draft: { ...session.draft, [input.stepId]: input.payload },
        updatedAt: nowIso(now),
      });
      await audit(
        input.organization.id,
        "step_saved",
        { stepId: input.stepId, needsVerification: needsVerify },
        input.actorUserId,
      );

      return {
        ok: true as const,
        snapshot: await getSnapshot(input.organization),
      };
    },

    async verify(input: {
      organization: Organization;
      kind: VerificationKind;
      actorUserId?: string | null;
      mode?: string;
    }) {
      const at = nowIso(now);
      const result = await runVerification(input);
      await deps.store.saveVerification({
        id: newId("iver"),
        businessId: input.organization.id,
        kind: input.kind,
        status: result.passed ? "passed" : "failed",
        detail: result.detail,
        error: result.passed ? null : result.error,
        verifiedAt: result.passed ? at : null,
        expiresAt: result.passed
          ? new Date(now().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null,
        createdAt: at,
        updatedAt: at,
      });

      if (result.passed) {
        const stepId = stepForVerification(input.kind);
        if (stepId) {
          await markStep(input.organization.id, stepId, {
            status: "verified",
            verifiedAt: at,
            completedAt: at,
            lastError: null,
          });
        }
      }

      await audit(
        input.organization.id,
        result.passed ? "verification_passed" : "verification_failed",
        { kind: input.kind, ...result.detail },
        input.actorUserId,
      );

      return {
        ok: result.passed,
        error: result.error,
        detail: result.detail,
        readiness: await computeReadiness(input.organization),
      };
    },

    async activate(input: {
      organization: Organization;
      actorUserId?: string | null;
    }) {
      const readiness = await computeReadiness(input.organization);
      if (!readiness.canActivate) {
        return {
          ok: false as const,
          error: "Activation blocked — required checks have not passed.",
          readiness,
          status: 409,
        };
      }

      const session = await ensureSession(input.organization);
      // Idempotent: do not duplicate activation side effects.
      if (session.activatedAt && !session.deactivatedAt) {
        return {
          ok: true as const,
          alreadyActive: true,
          readiness,
        };
      }

      const plan = input.organization.plan;
      let activatedAi = false;
      if (
        plan === "ai_receptionist" &&
        orgHasFeature(plan, "AI_PHONE_ANSWERING")
      ) {
        const runtime = getReceptionistRuntime();
        const profile = await runtime.profileStore.getProfile(
          input.organization.id,
        );
        if (profile && !profile.activated) {
          // Activation only if number already assigned (ops-provisioned).
          if (profile.phoneNumberE164) {
            await runtime.profileStore.setActivation(
              input.organization.id,
              {
                phoneNumberE164: profile.phoneNumberE164,
                activated: true,
              },
              input.actorUserId ?? "onboarding",
            );
            await runtime.refresh(true);
            activatedAi = true;
          }
        } else if (profile?.activated) {
          activatedAi = true;
        }
      }

      const at = nowIso(now);
      await deps.store.saveSession({
        ...session,
        status: "active",
        currentStep: "activation",
        activatedAt: at,
        deactivatedAt: null,
        updatedAt: at,
      });
      await markStep(input.organization.id, "activation", {
        status: "verified",
        completedAt: at,
        verifiedAt: at,
        payload: { activatedAi },
      });
      await getGrowthStore().upsertOrgSettings(input.organization.id, {
        onboardingCompletedAt: at,
      });
      await audit(
        input.organization.id,
        "activated",
        { activatedAi, plan },
        input.actorUserId,
      );

      return {
        ok: true as const,
        alreadyActive: false,
        activatedAi,
        readiness: await computeReadiness(input.organization),
      };
    },

    async deactivate(input: {
      organization: Organization;
      actorUserId?: string | null;
      reason?: string;
    }) {
      const session = await ensureSession(input.organization);
      const runtime = getReceptionistRuntime();
      const profile = await runtime.profileStore.getProfile(
        input.organization.id,
      );
      if (profile?.activated && profile.phoneNumberE164) {
        await runtime.profileStore.setActivation(
          input.organization.id,
          {
            phoneNumberE164: profile.phoneNumberE164,
            activated: false,
          },
          input.actorUserId ?? "onboarding",
        );
        await runtime.refresh(true);
      }
      const at = nowIso(now);
      await deps.store.saveSession({
        ...session,
        status: "suspended",
        deactivatedAt: at,
        updatedAt: at,
      });
      await audit(
        input.organization.id,
        "deactivated",
        { reason: input.reason ?? null },
        input.actorUserId,
      );
      return {
        ok: true as const,
        readiness: await computeReadiness(input.organization),
      };
    },
  };
}

function nextStep(current: OnboardingStepId): OnboardingStepId {
  const idx = ONBOARDING_STEP_IDS.indexOf(current);
  return ONBOARDING_STEP_IDS[Math.min(idx + 1, ONBOARDING_STEP_IDS.length - 1)]!;
}

function stepForVerification(kind: VerificationKind): OnboardingStepId | null {
  if (kind === "phone" || kind === "test_call" || kind === "transfer") return "phone";
  if (kind === "calendar") return "calendar";
  if (kind === "ai") return "ai_receptionist";
  if (kind === "messaging") return "automations";
  if (kind === "subscription") return "account";
  return null;
}

async function applyStepPayload(input: {
  organization: Organization;
  stepId: OnboardingStepId;
  payload: Record<string, unknown>;
}): Promise<
  | { ok: true; needsVerification: boolean }
  | { ok: false; error: string; status?: number }
> {
  const { organization, stepId, payload } = input;

  if (stepId === "account") {
    const plan = payload.plan;
    if (
      plan === "starter" ||
      plan === "growth" ||
      plan === "ai_receptionist"
    ) {
      // Do not invent a Stripe subscription — only confirm org plan when
      // no Stripe-backed sub exists / manual demo assignment.
      const { getBillingStore } = await import("@/product/billing/runtime");
      const sub = await getBillingStore().getSubscription(organization.id);
      if (!sub?.stripeSubscriptionId) {
        await getSaasStore().updateOrganizationPlan(organization.id, plan);
      }
    }
    if (payload.termsAccepted !== true && payload.termsAccepted !== "true") {
      return { ok: false, error: "Terms acceptance is required." };
    }
    return { ok: true, needsVerification: false };
  }

  if (stepId === "business") {
    const name = String(payload.businessName ?? payload.name ?? "").trim();
    if (name.length < 2) {
      return { ok: false, error: "Business name is required." };
    }
    const services = Array.isArray(payload.services)
      ? payload.services.map(String)
      : String(payload.services ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    const serviceAreas = Array.isArray(payload.serviceAreas)
      ? payload.serviceAreas.map(String)
      : String(payload.serviceArea ?? payload.serviceAreas ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

    await getSaasStore().updateOrganization(organization.id, {
      name,
      industry: payload.industry != null ? String(payload.industry) : undefined,
      city: payload.city != null ? String(payload.city) : undefined,
      serviceArea: serviceAreas.join(", "),
      timezone: payload.timezone
        ? String(payload.timezone)
        : organization.timezone,
      localeDefault:
        payload.language === "fr" || payload.language === "en"
          ? payload.language
          : organization.localeDefault,
      phoneE164: payload.businessPhone
        ? String(payload.businessPhone)
        : undefined,
    });

    // Seed AI knowledge from business info (same profile store — no duplicate DB).
    const runtime = getReceptionistRuntime();
    const existing = await runtime.profileStore.getProfile(organization.id);
    const base = existing?.settings ?? defaultProfileSettings();
    const knowledge = knowledgeSchema.parse({
      ...base.knowledge,
      companyName: name,
      industry: payload.industry ? String(payload.industry) : base.knowledge?.industry,
      services: services.length ? services : base.knowledge?.services ?? [],
      serviceAreas: serviceAreas.length
        ? serviceAreas
        : base.knowledge?.serviceAreas ?? [],
      emergencyServices: Boolean(payload.emergencyService),
      startingPrices: payload.startingPrices
        ? String(payload.startingPrices)
        : base.knowledge?.startingPrices,
      additionalInstructions: payload.description
        ? String(payload.description)
        : base.knowledge?.additionalInstructions,
    });

    await runtime.profileStore.saveSettings(
      organization.id,
      {
        ...base,
        knowledge,
        personality: payload.businessHours
          ? `Hours: ${String(payload.businessHours)}`
          : base.personality,
      },
      "onboarding",
    );

    return { ok: true, needsVerification: false };
  }

  if (stepId === "ai_receptionist") {
    if (!orgHasFeature(organization.plan, "AI_PHONE_ANSWERING")) {
      return {
        ok: false,
        error:
          "AI Receptionist is not included in your plan. Upgrade to enable call answering.",
        status: 402,
      };
    }
    const runtime = getReceptionistRuntime();
    const existing = await runtime.profileStore.getProfile(organization.id);
    const base = existing?.settings ?? defaultProfileSettings();
    const lang =
      payload.language === "en" || payload.language === "fr"
        ? payload.language
        : base.defaultLanguage;
    const greeting = payload.welcomeGreeting
      ? String(payload.welcomeGreeting)
      : undefined;
    const body = {
      ...base,
      receptionistName: String(
        payload.receptionistName ?? payload.aiName ?? base.receptionistName ?? "Sophie",
      ),
      greetingFr: String(payload.greetingFr ?? greeting ?? base.greetingFr ?? ""),
      greetingEn: String(payload.greetingEn ?? greeting ?? base.greetingEn ?? ""),
      defaultLanguage: lang,
      personality: payload.personality
        ? String(payload.personality)
        : base.personality,
      callHandlingMode:
        payload.callRouting === "human_first" ||
        payload.callHandlingMode === "human_first"
          ? "human_first"
          : base.callHandlingMode,
      knowledge: payload.knowledge ?? base.knowledge,
      collectFields:
        payload.informationCollection ??
        payload.collectFields ??
        base.collectFields,
      transferSettings:
        payload.humanEscalation ??
        payload.transferSettings ??
        base.transferSettings,
    };
    const result = await saveOwnerSettings(
      {
        profiles: runtime.profileStore,
        getClient: async (clientId) => {
          try {
            const { store } = await ensureMissedCallReady();
            return store.getClient(clientId);
          } catch {
            return null;
          }
        },
        refresh: (force) => runtime.refresh(force),
      },
      {
        organization,
        role: "owner",
        userEmail: "onboarding@tradecatch.local",
        body,
      },
    );
    if (result.status >= 400) {
      return {
        ok: false,
        error:
          (result.body as { error?: string })?.error ||
          "AI configuration rejected.",
        status: result.status,
      };
    }
    return { ok: true, needsVerification: true };
  }

  if (stepId === "phone") {
    const runtime = getReceptionistRuntime();
    const existing = await runtime.profileStore.getProfile(organization.id);
    const base = existing?.settings ?? defaultProfileSettings();
    const inboundStrategy =
      payload.callRouting === "human_first" ||
      payload.callRouting === "ai_first"
        ? payload.callRouting
        : base.phoneSettings?.inboundStrategy ?? "ai_first";
    const phoneSettings = {
      ...(base.phoneSettings ?? {}),
      businessPhoneE164: payload.existingBusinessNumber
        ? String(payload.existingBusinessNumber)
        : base.phoneSettings?.businessPhoneE164,
      tradecatchNumberE164: payload.tradecatchNumber
        ? String(payload.tradecatchNumber)
        : base.phoneSettings?.tradecatchNumberE164,
      inboundStrategy,
      humanTransferE164: payload.humanTransferNumber
        ? String(payload.humanTransferNumber)
        : base.phoneSettings?.humanTransferE164,
      backupTransferE164: payload.backupNumber
        ? String(payload.backupNumber)
        : base.phoneSettings?.backupTransferE164,
      forwardingInstructionsAck: Boolean(payload.forwardingInstructionsAck),
      connectionDetail: payload.connectionMethod
        ? String(payload.connectionMethod)
        : base.phoneSettings?.connectionDetail,
    };
    await runtime.profileStore.saveSettings(
      organization.id,
      {
        ...base,
        phoneSettings: {
          ...phoneSettings,
          inboundStrategy,
        },
        transferSettings: {
          ...base.transferSettings,
          primaryTransferE164: payload.humanTransferNumber
            ? String(payload.humanTransferNumber)
            : base.transferSettings?.primaryTransferE164,
          secondaryTransferE164: payload.backupNumber
            ? String(payload.backupNumber)
            : base.transferSettings?.secondaryTransferE164,
        },
      },
      "onboarding",
    );
    const assigned =
      (phoneSettings.tradecatchNumberE164 as string | undefined) ??
      existing?.phoneNumberE164;
    if (assigned) {
      await runtime.profileStore.setActivation(
        organization.id,
        {
          phoneNumberE164: assigned,
          activated: existing?.activated ?? false,
        },
        "onboarding",
      );
    }
    if (payload.existingBusinessNumber) {
      await getSaasStore().updateOrganization(organization.id, {
        phoneE164: String(payload.existingBusinessNumber),
      });
    }
    return { ok: true, needsVerification: true };
  }

  if (stepId === "calendar") {
    // OAuth is started via /calendar/connect — this step only stores booking prefs.
    return { ok: true, needsVerification: Boolean(payload.connectGoogle) };
  }

  if (stepId === "automations") {
    if (payload.notifyEmail) {
      await getGrowthStore().upsertOrgSettings(organization.id, {
        notifyEmail: String(payload.notifyEmail),
      });
    }
    // Enabling specific automations uses existing automation APIs; we only
    // record preferences here and require messaging verification.
    return {
      ok: true,
      needsVerification: Boolean(
        payload.enableMissedCall || payload.enableQuoteFollowUps,
      ),
    };
  }

  if (stepId === "activation") {
    return { ok: true, needsVerification: false };
  }

  return { ok: false, error: "Unknown step." };
}

async function runVerification(input: {
  organization: Organization;
  kind: VerificationKind;
  mode?: string;
}): Promise<{
  passed: boolean;
  error: string | null;
  detail: Record<string, unknown>;
}> {
  const org = input.organization;

  if (input.kind === "subscription") {
    const { getSubscriptionService } = await import(
      "@/product/billing/runtime"
    );
    const ent = await getSubscriptionService().getEffective(org.id, org.plan);
    const passed =
      ent.accessMode === "manual" ||
      ent.accessMode === "full" ||
      ent.accessMode === "grace";
    return {
      passed,
      error: passed ? null : "No usable subscription entitlements.",
      detail: { accessMode: ent.accessMode, status: ent.status, plan: ent.plan },
    };
  }

  if (input.kind === "ai") {
    if (!orgHasFeature(org.plan, "AI_PHONE_ANSWERING")) {
      return {
        passed: false,
        error: "AI Receptionist not on plan.",
        detail: { plan: org.plan },
      };
    }
    const live = await probeIntegrations(org);
    return {
      passed: live.aiConfigured,
      error: live.aiConfigured ? null : live.aiDetail,
      detail: { aiDetail: live.aiDetail },
    };
  }

  if (input.kind === "phone") {
    const live = await probeIntegrations(org);
    // Configuration alone is not enough — require forwarding ack or assigned number.
    const profile = await getReceptionistRuntime().profileStore.getProfile(
      org.id,
    );
    const hasNumber = Boolean(
      profile?.phoneNumberE164 ||
        profile?.settings?.phoneSettings?.tradecatchNumberE164 ||
        org.phoneE164,
    );
    const ack = Boolean(
      profile?.settings?.phoneSettings?.forwardingInstructionsAck,
    );
    const passed = hasNumber && (ack || Boolean(profile?.phoneNumberE164));
    return {
      passed,
      error: passed
        ? null
        : "Assign a TradeCatch number or acknowledge forwarding setup, then run a test call.",
      detail: {
        phoneDetail: live.phoneDetail,
        hasNumber,
        forwardingAck: ack,
      },
    };
  }

  if (input.kind === "test_call") {
    const mode = input.mode ?? "simulation";
    if (mode === "simulation") {
      const runtime = getReceptionistRuntime();
      const profile =
        (await runtime.profileStore.getProfile(org.id)) ?? {
          organizationId: org.id,
          activated: false,
          settings: defaultProfileSettings(),
          updatedAt: new Date().toISOString(),
        };
      try {
        let client = null;
        if (org.missedCallClientId) {
          const ready = await ensureMissedCallReady();
          client = await ready.store.getClient(org.missedCallClientId);
        }
        if (!client) {
          return {
            passed: false,
            error:
              "Link a missed-call / phone client before running the call test.",
            detail: { mode: "simulation" },
          };
        }
        const result = await runSimulatedPhoneScenario({
          organizationId: org.id,
          profile,
          client,
          scenario: "ai_answers",
          language: org.localeDefault === "fr" ? "fr" : "en",
        });
        const passed = Boolean(
          (result as { ok?: boolean })?.ok !== false,
        );
        return {
          passed,
          error: passed ? null : "Simulated call failed.",
          detail: {
            mode: "simulation",
            note: "Simulation verifies configuration only. A live inbound call is still required before AI answering activation on AI plans.",
            result,
          },
        };
      } catch (err) {
        return {
          passed: false,
          error: err instanceof Error ? err.message : "Simulation failed",
          detail: { mode: "simulation" },
        };
      }
    }
    // live_instructions — contractor must call; we mark pending unless they
    // confirm via mode=confirm_live after observing Call History.
    if (mode === "confirm_live") {
      return {
        passed: true,
        error: null,
        detail: {
          mode: "confirm_live",
          note: "Contractor confirmed an authorized inbound test call reached TradeCatch.",
        },
      };
    }
    return {
      passed: false,
      error:
        "Call the staging number from an authorized device, then confirm the live test.",
      detail: { mode: "live_instructions" },
    };
  }

  if (input.kind === "calendar") {
    if (!orgHasFeature(org.plan, "APPOINTMENT_BOOKING")) {
      return {
        passed: true,
        error: null,
        detail: { skipped: true, reason: "Not on plan" },
      };
    }
    try {
      const cal = await getSchedulingService().connectionStatus(org.id);
      const passed =
        cal.status === "connected" || cal.status === "simulated";
      return {
        passed,
        error: passed ? null : "Connect Google Calendar or use request-only booking.",
        detail: { status: cal.status, calendarId: cal.calendarId ?? null },
      };
    } catch (err) {
      return {
        passed: false,
        error: err instanceof Error ? err.message : "Calendar check failed",
        detail: {},
      };
    }
  }

  if (input.kind === "messaging") {
    const live = await probeIntegrations(org);
    return {
      passed: live.messagingReady,
      error: live.messagingReady ? null : live.messagingDetail,
      detail: { messagingDetail: live.messagingDetail },
    };
  }

  if (input.kind === "transfer") {
    const live = await probeIntegrations(org);
    return {
      passed: live.transferConfigured,
      error: live.transferConfigured
        ? null
        : "Add an authorized Canadian transfer number.",
      detail: {},
    };
  }

  return { passed: false, error: "Unknown verification kind.", detail: {} };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;
