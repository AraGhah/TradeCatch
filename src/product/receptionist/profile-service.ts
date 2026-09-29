/**
 * Owner + ops operations on receptionist profiles, independent of HTTP so the
 * rules (roles, validation, activation guard, number conflicts) are unit-tested.
 * The route handlers only authenticate and translate `{ status, body }`.
 */

import type { ClientAccount } from "@/product/missed-call/types";
import {
  defaultProfileSettings,
  profileSettingsSchema,
  validateProfile,
  type ProfileIssue,
} from "./profile";
import { isProfileConflict, type ProfileStore } from "./profile-store";

export type ServiceResult = { status: number; body: Record<string, unknown> };

export type OwnerSaveDeps = {
  profiles: ProfileStore;
  getClient(clientAccountId: string): Promise<ClientAccount | null>;
  /** Re-read tenant profiles so new calls use the change immediately here. */
  refresh(force: boolean): Promise<void>;
  addTimeline?(input: {
    organizationId: string;
    actor: string;
    at: string;
  }): Promise<unknown>;
  env?: NodeJS.ProcessEnv;
};

export async function saveOwnerSettings(
  deps: OwnerSaveDeps,
  input: {
    organization: { id: string; missedCallClientId: string | null };
    role: "owner" | "admin" | "member";
    userEmail: string;
    body: unknown;
  },
): Promise<ServiceResult> {
  if (input.role !== "owner" && input.role !== "admin") {
    return {
      status: 403,
      body: { error: "Only an owner or admin can change the receptionist." },
    };
  }

  const parsed = profileSettingsSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "Invalid settings.",
        issues: parsed.error.issues.map((i): ProfileIssue => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
    };
  }

  const client = input.organization.missedCallClientId
    ? await deps.getClient(input.organization.missedCallClientId)
    : null;
  if (!client) {
    return {
      status: 409,
      body: {
        error:
          "Your phone client is not linked yet. Ask the founder to connect it.",
      },
    };
  }

  const existing = await deps.profiles.getProfile(input.organization.id);
  const checked = validateProfile(
    {
      organizationId: input.organization.id,
      phoneNumberE164: existing?.phoneNumberE164,
      activated: existing?.activated ?? false,
      settings: parsed.data,
      updatedAt: new Date().toISOString(),
    },
    { client, env: deps.env },
  );
  if (!checked.ok) {
    return {
      status: 400,
      body: { error: "Invalid settings.", issues: checked.issues },
    };
  }

  // Ops fields (number, activation) are never taken from the owner's payload.
  const saved = await deps.profiles.saveSettings(
    input.organization.id,
    parsed.data,
    input.userEmail,
  );
  await deps.refresh(true);
  try {
    await deps.addTimeline?.({
      organizationId: input.organization.id,
      actor: input.userEmail,
      at: saved.updatedAt,
    });
  } catch (err) {
    console.warn("[receptionist] timeline write failed", err);
  }

  return {
    status: 200,
    body: {
      ok: true,
      activated: saved.activated,
      settings: saved.settings,
      updatedAt: saved.updatedAt,
    },
  };
}

export type ActivateDeps = {
  profiles: ProfileStore;
  getOrganization(
    id: string,
  ): Promise<{ id: string; missedCallClientId: string | null } | null>;
  getClient(clientAccountId: string): Promise<ClientAccount | null>;
  refresh(force: boolean): Promise<void>;
  /** True when the profile is now answering calls (after refresh). */
  isAnswering(organizationId: string): boolean;
  env?: NodeJS.ProcessEnv;
};

export async function activateProfile(
  deps: ActivateDeps,
  input: {
    organizationId: string;
    phoneNumberE164: string;
    activated: boolean;
    actor: string;
  },
): Promise<ServiceResult> {
  const org = await deps.getOrganization(input.organizationId);
  if (!org) return { status: 404, body: { error: "Organization not found." } };
  if (!org.missedCallClientId) {
    return {
      status: 409,
      body: { error: "Link the organization to a missed-call client first." },
    };
  }
  const client = await deps.getClient(org.missedCallClientId);
  if (!client)
    return { status: 404, body: { error: "Missed-call client not found." } };

  if (input.activated) {
    // Never go live with settings that would not pass the production checks.
    const existing = await deps.profiles.getProfile(input.organizationId);
    const checked = validateProfile(
      {
        organizationId: input.organizationId,
        phoneNumberE164: input.phoneNumberE164,
        activated: true,
        settings: existing?.settings ?? defaultProfileSettings(),
        updatedAt: new Date().toISOString(),
      },
      { client, env: deps.env },
    );
    if (!checked.ok) {
      return {
        status: 400,
        body: {
          error: "Profile is not ready to activate.",
          issues: checked.issues,
        },
      };
    }
  }

  try {
    const profile = await deps.profiles.setActivation(
      input.organizationId,
      { phoneNumberE164: input.phoneNumberE164, activated: input.activated },
      input.actor,
    );
    await deps.refresh(true);
    return {
      status: 200,
      body: {
        ok: true,
        organizationId: input.organizationId,
        activated: profile.activated,
        phoneNumberE164: profile.phoneNumberE164,
        answering: deps.isAnswering(input.organizationId),
      },
    };
  } catch (err) {
    if (isProfileConflict(err)) {
      const message =
        err instanceof Error ? err.message : "Number already in use";
      return { status: 409, body: { error: message } };
    }
    throw err;
  }
}
