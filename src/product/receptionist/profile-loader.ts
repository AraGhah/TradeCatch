import type { ClientAccount } from "@/product/missed-call/types";
import { validateProfile } from "./profile";
import type { ProfileStore } from "./profile-store";
import type { ReceptionistConfig } from "./types";

export type ProfileLoaderDeps = {
  profiles: ProfileStore;
  getOrganization(id: string): Promise<{
    id: string;
    status: string;
    missedCallClientId: string | null;
  } | null>;
  getClient(clientAccountId: string): Promise<ClientAccount | null>;
  env?: NodeJS.ProcessEnv;
  onSkip?: (organizationId: string, reason: string) => void;
};

/**
 * Activated profiles → configs. A profile that cannot be built (organization
 * suspended or unlinked, client missing, settings invalid in production) is
 * skipped and reported, never half-loaded.
 */
export async function loadProfileConfigs(
  deps: ProfileLoaderDeps,
): Promise<ReceptionistConfig[]> {
  const out: ReceptionistConfig[] = [];
  const claimed = new Set<string>();

  for (const profile of await deps.profiles.listActivatedProfiles()) {
    const skip = (reason: string) =>
      deps.onSkip?.(profile.organizationId, reason);
    const org = await deps.getOrganization(profile.organizationId);
    if (!org || org.status !== "active") {
      skip("organization_inactive");
      continue;
    }
    if (!org.missedCallClientId) {
      skip("organization_not_linked_to_client");
      continue;
    }
    const client = await deps.getClient(org.missedCallClientId);
    if (!client) {
      skip("client_missing");
      continue;
    }
    const result = validateProfile(profile, { client, env: deps.env });
    if (!result.ok) {
      skip(`invalid:${result.issues.map((i) => i.message).join("; ")}`);
      continue;
    }
    const digits = result.config.phoneNumberE164.replace(/\D/g, "");
    if (claimed.has(digits)) {
      skip("duplicate_number");
      continue;
    }
    claimed.add(digits);
    out.push(result.config);
  }
  return out;
}
