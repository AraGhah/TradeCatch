import type { PlanId } from "@/product/saas/entitlements";
import { STANDARD_AGENT_VOICE, type AgentVoice } from "./model";

/** The business a receptionist config belongs to, or null for any other kind of config. */
export function organizationIdFromConfigId(configId: string): string | null {
  const match = /^rc_org_(.+)$/.exec(configId);
  return match?.[1] ?? null;
}

export type AgentVoiceDeps = {
  getOrganization(id: string): Promise<{ id: string; plan: PlanId } | null>;
  voices: {
    resolveForAgent(organizationId: string, plan: PlanId): Promise<AgentVoice>;
  };
};

/**
 * Which voice should this business's next call speak with? The plan comes from
 * the stored organization (not from the config or the request), so a downgrade
 * takes effect on the very next call. Any failure — no organization, a store
 * outage, a provider that is not configured — is the standard voice, so voice
 * cloning can never stop a call being answered.
 */
export async function resolveAgentVoice(
  configId: string,
  deps: AgentVoiceDeps,
): Promise<AgentVoice> {
  try {
    const organizationId = organizationIdFromConfigId(configId);
    if (!organizationId) return STANDARD_AGENT_VOICE;
    const organization = await deps.getOrganization(organizationId);
    if (!organization) return STANDARD_AGENT_VOICE;
    return await deps.voices.resolveForAgent(organization.id, organization.plan);
  } catch {
    return STANDARD_AGENT_VOICE;
  }
}
