/**
 * One-call self-serve provisioning: buys a Twilio number for an
 * organization that has none yet, builds its Module A client record from
 * fields the organization already has on file, links the two, and rolls
 * the purchase back if anything after that fails. This replaces the old
 * "ops edits a Cloudflare env var, then calls /ops/link-organization"
 * two-step with a single authorized API call — see
 * /api/missed-call/ops/provision-number, the only route that calls this.
 */

import {
  purchaseNumber,
  releaseNumber,
  searchAvailableNumbers,
  NumberProvisioningError,
  type AvailableNumber,
} from "./number-provisioning";
import { validateClientConfig } from "./client-config";
import { defaultApprovedQuestions } from "./messaging";
import { defaultUrgencyRubric } from "./urgency";
import { defaultServiceAreas } from "./fixtures";
import type { ClientAccount } from "./types";
import type { MissedCallStore } from "./store";

export type OrganizationForProvisioning = {
  id: string;
  name: string;
  timezone: string;
  phoneE164: string | null;
  missedCallClientId: string | null;
};

export type ProvisionDeps = {
  store: MissedCallStore;
  linkMissedCallClient(
    organizationId: string,
    clientId: string,
  ): Promise<unknown>;
  env?: NodeJS.ProcessEnv;
};

export type ProvisionResult = {
  clientAccountId: string;
  smsFromNumber: string;
};

function buildClientAccount(input: {
  organization: OrganizationForProvisioning;
  smsFromNumber: string;
}): ClientAccount {
  const { organization, smsFromNumber } = input;
  const ownerPhone = organization.phoneE164!;
  return {
    id: `org_${organization.id}`,
    name: organization.name,
    contractorDisplayName: organization.name,
    timezone: organization.timezone,
    businessHours: { start: "08:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    approvedServiceAreas: defaultServiceAreas(),
    urgencyRubric: defaultUrgencyRubric(),
    technicianRoster: [
      {
        id: "tech_owner",
        name: organization.name,
        phone: ownerPhone,
        role: "primary",
        active: true,
      },
    ],
    mainTechnicianId: "tech_owner",
    backupTechnicianIds: [],
    ownerTechnicianId: "tech_owner",
    onCallSchedule: [1, 2, 3, 4, 5].map((day) => ({
      day,
      start: "08:00",
      end: "17:00",
      technicianId: "tech_owner",
    })),
    escalationPolicy: {
      primaryResponseMs: 5 * 60 * 1000,
      backupResponseMs: 5 * 60 * 1000,
      ownerResponseMs: 10 * 60 * 1000,
    },
    timeouts: { customerCollectionMs: 2 * 60 * 60 * 1000 },
    humanReviewPhone: ownerPhone,
    onCallTechnicians: [
      {
        id: "tech_owner",
        name: organization.name,
        phone: ownerPhone,
        active: true,
      },
    ],
    approvedQuestions: defaultApprovedQuestions(),
    smsFromNumber,
    optOutKeywords: ["stop", "arret", "arrêt"],
    duplicateWindowMs: 30 * 60 * 1000,
  };
}

/**
 * Buys a number and finishes linking it to the organization. Every
 * failure after the purchase releases the number before returning, so a
 * bad save never leaves an orphaned, still-billed number behind.
 */
export async function provisionOrganizationSmsNumber(
  deps: ProvisionDeps,
  input: {
    organization: OrganizationForProvisioning;
    areaCode?: string;
    /** For tests / a human-reviewed pick-from-a-list flow; skips the search. */
    chooseNumber?: (candidates: AvailableNumber[]) => AvailableNumber;
  },
): Promise<ProvisionResult> {
  const env = deps.env ?? process.env;
  const { organization } = input;

  if (organization.missedCallClientId) {
    throw new NumberProvisioningError(
      "This organization is already linked to an SMS receptionist number.",
      409,
    );
  }
  if (!organization.phoneE164?.trim()) {
    throw new NumberProvisioningError(
      "Add a business phone number for this organization before provisioning an SMS receptionist number.",
      409,
    );
  }

  const candidates = await searchAvailableNumbers(
    { areaCode: input.areaCode, country: "CA", limit: 5 },
    env,
  );
  if (candidates.length === 0) {
    throw new NumberProvisioningError(
      "No available Twilio numbers matched that search.",
      409,
    );
  }
  const chosen = (input.chooseNumber ?? ((list) => list[0]!))(candidates);

  const purchased = await purchaseNumber(
    {
      phoneNumberE164: chosen.phoneNumberE164,
      friendlyName: `TradeCatch — ${organization.name}`,
    },
    env,
  );

  try {
    const client = buildClientAccount({
      organization,
      smsFromNumber: purchased.phoneNumberE164,
    });
    const check = validateClientConfig(client);
    if (!check.ok) {
      throw new NumberProvisioningError(
        `Could not build a valid SMS receptionist config: ${check.errors.join("; ")}`,
        500,
      );
    }
    await deps.store.saveClient(client);
    await deps.linkMissedCallClient(organization.id, client.id);
    return {
      clientAccountId: client.id,
      smsFromNumber: purchased.phoneNumberE164,
    };
  } catch (err) {
    await releaseNumber(purchased.sid, env);
    throw err;
  }
}
