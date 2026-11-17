/**
 * Why a "contractor's phone rings first" setting may not ring.
 *
 * Live transfer is a plan feature. On a plan without it the saved setting
 * stays saved, but a call goes straight to the receptionist, in a real call and
 * in a simulation alike. Without a word of explanation the owner sees a
 * setting that says one thing and a test that does another, so the dashboard
 * names the plan as the reason when (and only when) it is.
 */

import type { ClientAccount } from "@/product/missed-call/types";
import type { VoiceCapabilities } from "@/product/receptionist/plan-limits";
import {
  buildProfileConfig,
  type ReceptionistProfile,
} from "@/product/receptionist/profile";
import { resolveInboundRouting } from "./call-routing";

/**
 * True when the saved settings would ring the contractor's phone first if the
 * plan included live transfer, and the plan does not. Business hours, the
 * caller policy and every other rule are applied exactly as in a real call, so
 * an after-hours call, for example, is not blamed on the plan.
 */
export function ringFirstBlockedByPlan(input: {
  profile: ReceptionistProfile;
  client: ClientAccount;
  capabilities?: VoiceCapabilities;
  fromE164: string;
  now: Date;
}): boolean {
  if (!input.capabilities || input.capabilities.transfer) return false;
  try {
    const config = buildProfileConfig(input.profile, {
      client: input.client,
      capabilities: { ...input.capabilities, transfer: true },
    });
    const { routing } = resolveInboundRouting({
      config,
      fromE164: input.fromE164,
      now: input.now,
    });
    return routing.action === "ring_human";
  } catch {
    return false;
  }
}
