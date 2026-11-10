import type { ClientAccount } from "@/product/missed-call/types";
import type { PlanId } from "@/product/saas/entitlements";
import { voiceCapabilitiesForPlan } from "./plan-limits";
import { validateProfile } from "./profile";
import type { ProfileStore } from "./profile-store";
import type { ReceptionistConfig } from "./types";

export type ProfileLoaderDeps = {
  profiles: ProfileStore;
  getOrganization(id: string): Promise<{
    id: string;
    status: string;
    plan: PlanId;
    missedCallClientId: string | null;
  } | null>;
  getClient(clientAccountId: string): Promise<ClientAccount | null>;
  env?: NodeJS.ProcessEnv;
  onSkip?: (organizationId: string, reason: string) => void;
};

/**
 * How many organization/client lookups run at once. The agent waits for this
 * load before it can greet a caller (on a cold server, the first call of the
 * minute), so one round trip per profile in a row is the slowest way to do it;
 * a small bound keeps a large account list from draining the database pool.
 */
const LOOKUP_CONCURRENCY = 8;

type Resolved =
  | { skip: string }
  | {
      client: ClientAccount;
      capabilities: ReturnType<typeof voiceCapabilitiesForPlan>;
    };

/** Like Promise.all(items.map(fn)), at most `limit` at a time, results in input order. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/**
 * Activated profiles → configs. A profile that cannot be built (organization
 * suspended or unlinked, client missing, settings invalid in production) is
 * skipped and reported, never half-loaded.
 *
 * The database lookups run a few at a time; everything that decides the result
 * (validation, skip reasons, and which profile keeps a number two profiles
 * share: the first, in store order) is applied afterwards, in order.
 */
export async function loadProfileConfigs(
  deps: ProfileLoaderDeps,
): Promise<ReceptionistConfig[]> {
  const profiles = await deps.profiles.listActivatedProfiles();

  const resolved = await mapWithLimit(
    profiles,
    LOOKUP_CONCURRENCY,
    async (profile): Promise<Resolved> => {
      const org = await deps.getOrganization(profile.organizationId);
      if (!org || org.status !== "active") {
        return { skip: "organization_inactive" };
      }
      if (!org.missedCallClientId) {
        return { skip: "organization_not_linked_to_client" };
      }
      // The plan decides whether the line answers at all, and how much of the
      // receptionist it gets (Growth: limited; Receptionist Plus: complete).
      const capabilities = voiceCapabilitiesForPlan(org.plan);
      if (!capabilities.voice) {
        return { skip: "plan_without_voice_receptionist" };
      }
      const client = await deps.getClient(org.missedCallClientId);
      if (!client) return { skip: "client_missing" };
      return { client, capabilities };
    },
  );

  const out: ReceptionistConfig[] = [];
  const claimed = new Set<string>();
  profiles.forEach((profile, index) => {
    const skip = (reason: string) =>
      deps.onSkip?.(profile.organizationId, reason);
    const found = resolved[index]!;
    if ("skip" in found) {
      skip(found.skip);
      return;
    }
    const result = validateProfile(profile, {
      client: found.client,
      env: deps.env,
      capabilities: found.capabilities,
    });
    if (!result.ok) {
      skip(`invalid:${result.issues.map((i) => i.message).join("; ")}`);
      return;
    }
    const digits = result.config.phoneNumberE164.replace(/\D/g, "");
    if (claimed.has(digits)) {
      skip("duplicate_number");
      return;
    }
    claimed.add(digits);
    out.push(result.config);
  });
  return out;
}
