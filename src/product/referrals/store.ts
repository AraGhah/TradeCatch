import {
  DEFAULT_REFERRAL_SETTINGS,
  type ReferralEvent,
  type ReferralRecord,
  type ReferralSettings,
  type ReferralStatus,
  type RewardRecord,
  type RewardStatus,
} from "./model";

export class ReferralConflictError extends Error {
  constructor(
    public readonly kind: "gift_card_reference" | "code",
    message: string,
  ) {
    super(message);
    this.name = "ReferralConflictError";
  }
}

export function isReferralConflict(
  err: unknown,
  kind?: ReferralConflictError["kind"],
): err is ReferralConflictError {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { name?: unknown }).name === "ReferralConflictError" &&
    (kind === undefined || (err as ReferralConflictError).kind === kind)
  );
}

/** Every write that matters is a compare-and-set, so two admins cannot both win. */
export type RewardTransition = {
  /** The reward must currently be in one of these states. */
  from: readonly RewardStatus[];
  to: RewardStatus;
  patch?: Partial<
    Pick<
      RewardRecord,
      | "decidedBy"
      | "decidedAt"
      | "decisionNote"
      | "rejectionReason"
      | "fulfillmentMethod"
      | "giftCardReference"
      | "issuedBy"
      | "issuedAt"
      | "reviewFlags"
    >
  >;
  at: string;
};

export type ReferralStore = {
  getSettings(): Promise<ReferralSettings>;
  saveSettings(settings: ReferralSettings): Promise<ReferralSettings>;

  getCodeForOrganization(organizationId: string): Promise<string | null>;
  /** Idempotent per organization. Throws ReferralConflictError("code") if the code is taken. */
  createCode(
    organizationId: string,
    code: string,
    at: string,
  ): Promise<{ code: string; created: boolean }>;
  findOrganizationByCode(code: string): Promise<string | null>;

  /** One referral per referred organization (unique): created=false if it already had one. */
  insertReferral(
    record: ReferralRecord,
  ): Promise<{ created: boolean; record: ReferralRecord }>;
  getReferral(id: string): Promise<ReferralRecord | null>;
  getReferralByReferred(organizationId: string): Promise<ReferralRecord | null>;
  listReferralsForReferrer(organizationId: string): Promise<ReferralRecord[]>;
  listReferrals(filter?: {
    status?: ReferralStatus;
    limit?: number;
  }): Promise<ReferralRecord[]>;
  updateReferral(
    id: string,
    patch: Partial<
      Pick<
        ReferralRecord,
        "status" | "rejectionReason" | "reviewFlags" | "qualifiedAt" | "updatedAt"
      >
    >,
  ): Promise<ReferralRecord | null>;

  /**
   * One reward per referral, per referred business and per Checkout Session
   * (all unique): created=false returns the reward that already exists, which
   * is what makes a replayed webhook harmless.
   */
  insertReward(
    reward: RewardRecord,
  ): Promise<{ created: boolean; reward: RewardRecord }>;
  getReward(id: string): Promise<RewardRecord | null>;
  getRewardByReferral(referralId: string): Promise<RewardRecord | null>;
  getRewardByReferredOrganization(
    organizationId: string,
  ): Promise<RewardRecord | null>;
  getRewardByPaymentIntent(paymentIntentId: string): Promise<RewardRecord | null>;
  listRewardsForReferrer(organizationId: string): Promise<RewardRecord[]>;
  listRewards(filter?: {
    status?: RewardStatus;
    limit?: number;
  }): Promise<RewardRecord[]>;
  /** Compare-and-set. Returns null when the reward was not in a `from` state. */
  transitionReward(
    id: string,
    transition: RewardTransition,
  ): Promise<RewardRecord | null>;
  addRewardFlags(
    id: string,
    flags: RewardRecord["reviewFlags"],
    at: string,
  ): Promise<RewardRecord | null>;

  addEvent(event: ReferralEvent): Promise<void>;
  listEvents(filter: {
    referralId?: string;
    rewardId?: string;
    limit?: number;
  }): Promise<ReferralEvent[]>;
};

/* -------------------------------------------------------------------------- */
/* In-memory implementation (development, tests)                              */
/* -------------------------------------------------------------------------- */

export function createMemoryReferralStore(): ReferralStore {
  let settings: ReferralSettings = structuredClone(DEFAULT_REFERRAL_SETTINGS);
  const codeByOrg = new Map<string, string>();
  const orgByCode = new Map<string, string>();
  const referrals = new Map<string, ReferralRecord>();
  const rewards = new Map<string, RewardRecord>();
  const events: ReferralEvent[] = [];
  const clone = <T>(v: T): T => structuredClone(v);
  const byNewest = <T extends { registeredAt?: string; createdAt?: string }>(
    a: T,
    b: T,
  ) =>
    (b.registeredAt ?? b.createdAt ?? "").localeCompare(
      a.registeredAt ?? a.createdAt ?? "",
    );

  const findReward = (pred: (r: RewardRecord) => boolean) =>
    [...rewards.values()].find(pred) ?? null;

  return {
    async getSettings() {
      return clone(settings);
    },
    async saveSettings(next) {
      settings = clone(next);
      return clone(settings);
    },

    async getCodeForOrganization(organizationId) {
      return codeByOrg.get(organizationId) ?? null;
    },
    async createCode(organizationId, code) {
      const existing = codeByOrg.get(organizationId);
      if (existing) return { code: existing, created: false };
      if (orgByCode.has(code)) {
        throw new ReferralConflictError("code", "Referral code already in use");
      }
      codeByOrg.set(organizationId, code);
      orgByCode.set(code, organizationId);
      return { code, created: true };
    },
    async findOrganizationByCode(code) {
      return orgByCode.get(code) ?? null;
    },

    async insertReferral(record) {
      const existing = [...referrals.values()].find(
        (r) => r.referredOrganizationId === record.referredOrganizationId,
      );
      if (existing) return { created: false, record: clone(existing) };
      referrals.set(record.id, clone(record));
      return { created: true, record: clone(record) };
    },
    async getReferral(id) {
      const r = referrals.get(id);
      return r ? clone(r) : null;
    },
    async getReferralByReferred(organizationId) {
      const r = [...referrals.values()].find(
        (x) => x.referredOrganizationId === organizationId,
      );
      return r ? clone(r) : null;
    },
    async listReferralsForReferrer(organizationId) {
      return [...referrals.values()]
        .filter((r) => r.referrerOrganizationId === organizationId)
        .sort(byNewest)
        .map(clone);
    },
    async listReferrals(filter) {
      return [...referrals.values()]
        .filter((r) => !filter?.status || r.status === filter.status)
        .sort(byNewest)
        .slice(0, filter?.limit ?? 200)
        .map(clone);
    },
    async updateReferral(id, patch) {
      const current = referrals.get(id);
      if (!current) return null;
      const next = { ...current, ...patch };
      referrals.set(id, next);
      return clone(next);
    },

    async insertReward(reward) {
      const existing = findReward(
        (r) =>
          r.referralId === reward.referralId ||
          r.referredOrganizationId === reward.referredOrganizationId ||
          r.qualifyingSessionId === reward.qualifyingSessionId,
      );
      if (existing) return { created: false, reward: clone(existing) };
      rewards.set(reward.id, clone(reward));
      return { created: true, reward: clone(reward) };
    },
    async getReward(id) {
      const r = rewards.get(id);
      return r ? clone(r) : null;
    },
    async getRewardByReferral(referralId) {
      const r = findReward((x) => x.referralId === referralId);
      return r ? clone(r) : null;
    },
    async getRewardByReferredOrganization(organizationId) {
      const r = findReward((x) => x.referredOrganizationId === organizationId);
      return r ? clone(r) : null;
    },
    async getRewardByPaymentIntent(paymentIntentId) {
      const r = findReward((x) => x.qualifyingPaymentIntentId === paymentIntentId);
      return r ? clone(r) : null;
    },
    async listRewardsForReferrer(organizationId) {
      return [...rewards.values()]
        .filter((r) => r.referrerOrganizationId === organizationId)
        .sort(byNewest)
        .map(clone);
    },
    async listRewards(filter) {
      return [...rewards.values()]
        .filter((r) => !filter?.status || r.status === filter.status)
        .sort(byNewest)
        .slice(0, filter?.limit ?? 200)
        .map(clone);
    },
    async transitionReward(id, transition) {
      const current = rewards.get(id);
      if (!current || !transition.from.includes(current.status)) return null;
      // Same rule as the database's lower(gift_card_reference) unique index.
      const reference = transition.patch?.giftCardReference?.toLowerCase();
      if (
        reference &&
        findReward(
          (r) => r.id !== id && r.giftCardReference?.toLowerCase() === reference,
        )
      ) {
        throw new ReferralConflictError(
          "gift_card_reference",
          "Gift card reference already recorded on another reward",
        );
      }
      const next: RewardRecord = {
        ...current,
        ...transition.patch,
        status: transition.to,
        updatedAt: transition.at,
      };
      rewards.set(id, next);
      return clone(next);
    },
    async addRewardFlags(id, flags, at) {
      const current = rewards.get(id);
      if (!current) return null;
      const next = {
        ...current,
        reviewFlags: [...new Set([...current.reviewFlags, ...flags])],
        updatedAt: at,
      };
      rewards.set(id, next);
      return clone(next);
    },

    async addEvent(event) {
      events.push(clone(event));
    },
    async listEvents(filter) {
      return events
        .filter(
          (e) =>
            (!filter.referralId || e.referralId === filter.referralId) &&
            (!filter.rewardId || e.rewardId === filter.rewardId),
        )
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, filter.limit ?? 100)
        .map(clone);
    },
  };
}
