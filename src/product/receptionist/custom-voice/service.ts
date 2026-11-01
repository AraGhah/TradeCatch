/**
 * Custom Voice Cloning — business rules.
 *
 * The safeguards live here, not in the routes, so every entry point (dashboard
 * API, agent config, account deletion) gets them:
 *
 *  - Plan: only Receptionist Plus. Checked on every call that creates, previews
 *    or activates a cloned voice, and again when a call resolves its voice, so a
 *    downgrade stops the cloned voice immediately.
 *  - Consent: the owner must accept the current consent wording and type their
 *    name before a sample is even sent to the provider. Revoking consent removes
 *    the voice.
 *  - Verification: the sample must contain three words chosen by us moments
 *    earlier (see challenge.ts), confirmed by transcription. Fails closed.
 *  - Preview before live: a new voice never goes live on its own.
 *  - Fallback: anything uncertain resolves to the standard voice.
 *  - Tenant isolation: every read and write is keyed by the organization id the
 *    caller's session proved; nothing here accepts an id from a request body.
 */

import type { PlanId } from "@/product/saas/entitlements";
import { orgHasFeature } from "@/product/saas/entitlements";
import {
  issueChallenge,
  transcriptHasChallenge,
  verifyChallengeToken,
  wordCount,
  type ChallengeLocale,
  type IssuedChallenge,
} from "./challenge";
import { checkSample } from "./audio";
import { ProviderError, type VoiceProvider } from "./elevenlabs";
import {
  CONSENT_STATEMENT_VERSION,
  DEFAULT_TTS_MODEL,
  MIN_SAMPLE_WORDS,
  STANDARD_AGENT_VOICE,
  VOICE_PROVIDER,
  emptyVoiceRecord,
  type AgentVoice,
  type OrgVoiceRecord,
  type VoiceError,
  type VoiceEvent,
  type VoiceMode,
  type VoiceResult,
  type VoiceStatusView,
} from "./model";
import type { OrgVoiceStore } from "./store";

export type VoiceActor = {
  organizationId: string;
  plan: PlanId;
  userId: string;
};

export type CloneInput = {
  consent: { accepted: boolean; statementVersion: string; signerName: string };
  challengeToken: string;
  sample: Uint8Array;
};

export type VoiceService = {
  status(actor: VoiceActor): Promise<VoiceStatusView>;
  challenge(
    actor: VoiceActor,
    locale: ChallengeLocale,
  ): Promise<VoiceResult<{ challenge: IssuedChallenge; consentVersion: string }>>;
  createClone(
    actor: VoiceActor,
    input: CloneInput,
  ): Promise<VoiceResult<{ status: VoiceStatusView }>>;
  preview(
    actor: VoiceActor,
    locale: ChallengeLocale,
  ): Promise<VoiceResult<{ audio: Uint8Array; contentType: string }>>;
  setMode(
    actor: VoiceActor,
    mode: VoiceMode,
  ): Promise<VoiceResult<{ status: VoiceStatusView }>>;
  /** Deletes the cloned voice (here and at the provider). Always allowed. */
  deleteVoice(
    actor: VoiceActor,
  ): Promise<VoiceResult<{ status: VoiceStatusView }>>;
  /** Withdraws consent: the voice is stopped and deleted. Always allowed. */
  revokeConsent(
    actor: VoiceActor,
  ): Promise<VoiceResult<{ status: VoiceStatusView }>>;
  /**
   * What a call to this business should speak with. Never throws: any doubt
   * (not entitled, not previewed, consent revoked, store error) is the standard
   * voice, so a problem here can never take the receptionist down.
   */
  resolveForAgent(organizationId: string, plan: PlanId): Promise<AgentVoice>;
  /** Removes every trace when a business is deleted. False if the provider refused. */
  purgeOrganization(organizationId: string): Promise<boolean>;
  events(actor: VoiceActor, limit?: number): Promise<VoiceEvent[]>;
};

export type VoiceServiceDeps = {
  store: OrgVoiceStore;
  /** null when ELEVENLABS_API_KEY is not configured on this deployment. */
  provider: VoiceProvider | null;
  /** Server secret the verification challenge is signed with. */
  challengeSecret: string;
  now?: () => Date;
};

const PREVIEW_TEXT: Record<ChallengeLocale, string> = {
  en: "Hi, thanks for calling. I'm the virtual receptionist. How can I help you today?",
  fr: "Bonjour, merci d'avoir appelé. Je suis la réceptionniste virtuelle. Comment puis-je vous aider aujourd'hui ?",
};

const MAX_ATTEMPTS = 3;

function fail<T = never>(error: VoiceError): VoiceResult<T> {
  return { ok: false, error };
}

/** Maps a provider failure to something safe to show; never exposes provider text. */
function providerFailure(error: unknown): VoiceError {
  if (error instanceof ProviderError) {
    if (error.failure === "invalid_sample") return "sample_invalid";
    // Our own key being wrong or out of credit is our problem, not the customer's.
    if (error.failure === "unauthorized" || error.failure === "quota") return "unavailable";
  }
  return "provider_error";
}

export function createVoiceService(deps: VoiceServiceDeps): VoiceService {
  const { store, provider, challengeSecret } = deps;
  const now = deps.now ?? (() => new Date());
  const entitled = (plan: PlanId) => orgHasFeature(plan, "AI_CUSTOM_VOICE");

  /** The one place that decides whether calls use the cloned voice. */
  function isLive(record: OrgVoiceRecord | null, plan: PlanId): boolean {
    return Boolean(
      record &&
        entitled(plan) &&
        record.mode === "custom" &&
        record.status === "ready" &&
        record.providerVoiceId &&
        record.consent &&
        !record.consentRevokedAt &&
        record.previewedAt,
    );
  }

  function view(record: OrgVoiceRecord | null, plan: PlanId): VoiceStatusView {
    return {
      entitled: entitled(plan),
      available: provider !== null,
      mode: record?.mode ?? "standard",
      hasVoice: Boolean(record?.providerVoiceId && record.status === "ready"),
      live: isLive(record, plan),
      cleanupPending: record?.status === "deleting",
      previewed: Boolean(record?.previewedAt),
      consent: record?.consent
        ? {
            statementVersion: record.consent.statementVersion,
            signerName: record.consent.signerName,
            acceptedAt: record.consent.acceptedAt,
            outdated: record.consent.statementVersion !== CONSENT_STATEMENT_VERSION,
          }
        : null,
      consentRevokedAt: record?.consentRevokedAt ?? null,
      updatedAt: record?.updatedAt ?? null,
    };
  }

  async function event(
    actor: { organizationId: string; userId: string | null },
    action: VoiceEvent["action"],
    detail: VoiceEvent["detail"] = {},
  ) {
    try {
      await store.addEvent({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action,
        detail,
        createdAt: now().toISOString(),
      });
    } catch {
      // The audit trail must never turn a successful action into a failure.
    }
  }

  /**
   * Read-modify-write with a version check. `change` gets the current record
   * (or a fresh one) and returns the next; a concurrent writer makes us re-read
   * and re-apply rather than overwrite them.
   */
  async function mutate(
    organizationId: string,
    change: (current: OrgVoiceRecord) => OrgVoiceRecord | null,
  ): Promise<OrgVoiceRecord | null> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const at = now().toISOString();
      const current =
        (await store.get(organizationId)) ?? emptyVoiceRecord(organizationId, at);
      const next = change(current);
      if (!next) return null;
      const saved = await store.save({ ...next, updatedAt: at });
      if (saved) return saved;
    }
    return null;
  }

  /** Stops the voice for calls, then removes it at the provider. */
  async function removeVoice(
    actor: VoiceActor,
    reason: "deleted" | "consent_revoked",
  ): Promise<VoiceResult<{ status: VoiceStatusView }>> {
    const existing = await store.get(actor.organizationId);
    if (!existing) return { ok: true, status: view(null, actor.plan) };

    const at = now().toISOString();
    // Step 1 — before anything can fail: calls stop using the voice.
    let record: OrgVoiceRecord | null = existing;
    if (existing.mode !== "standard" || existing.status !== "deleting") {
      record = await mutate(actor.organizationId, (c) => ({
        ...c,
        mode: "standard",
        activatedAt: null,
        status: c.providerVoiceId ? "deleting" : "none",
        consentRevokedAt:
          reason === "consent_revoked" ? (c.consentRevokedAt ?? at) : c.consentRevokedAt,
        consentRevokedBy:
          reason === "consent_revoked" ? (c.consentRevokedBy ?? actor.userId) : c.consentRevokedBy,
      }));
      if (!record) return fail("provider_error");
    }

    // Step 2 — delete at the provider. A failure leaves the record "deleting"
    // (already on the standard voice) so the owner can retry.
    if (record.providerVoiceId) {
      try {
        if (!provider) throw new ProviderError("unavailable");
        await provider.deleteVoice(record.providerVoiceId);
      } catch {
        await event(actor, "provider_cleanup_failed", { reason });
        return { ok: true, status: view(record, actor.plan) };
      }
    }

    // Step 3 — the voice is gone: forget the handle and the consent that
    // covered it. A new clone needs fresh consent. A revocation stays visible.
    const done = await mutate(actor.organizationId, (c) => ({
      ...c,
      mode: "standard",
      status: "none",
      providerVoiceId: null,
      consent: null,
      verifiedAt: null,
      previewedAt: null,
      activatedAt: null,
    }));
    await event(actor, reason);
    return { ok: true, status: view(done ?? record, actor.plan) };
  }

  return {
    async status(actor) {
      return view(await store.get(actor.organizationId), actor.plan);
    },

    async challenge(actor, locale) {
      if (!entitled(actor.plan)) return fail("not_entitled");
      if (!provider) return fail("unavailable");
      const issued = await issueChallenge({
        secret: challengeSecret,
        organizationId: actor.organizationId,
        userId: actor.userId,
        locale,
        now: now(),
      });
      return { ok: true, challenge: issued, consentVersion: CONSENT_STATEMENT_VERSION };
    },

    async createClone(actor, input) {
      if (!entitled(actor.plan)) return fail("not_entitled");
      if (!provider) return fail("unavailable");

      // 1. Consent comes first: nothing is sent anywhere without it.
      const signer = input.consent.signerName.trim();
      if (!input.consent.accepted || signer.length < 2 || signer.length > 120) {
        return fail("consent_required");
      }
      if (input.consent.statementVersion !== CONSENT_STATEMENT_VERSION) {
        return fail("consent_outdated");
      }

      let before = await store.get(actor.organizationId);
      // A previous delete that the provider has not confirmed must finish first.
      if (before?.status === "deleting") {
        const cleaned = await removeVoice(actor, "deleted");
        if (!cleaned.ok || cleaned.status.cleanupPending) return fail("provider_error");
        before = await store.get(actor.organizationId);
      }

      // 2. The spoken challenge: signed by us, for this business and user.
      const checked = await verifyChallengeToken({
        secret: challengeSecret,
        token: input.challengeToken,
        organizationId: actor.organizationId,
        userId: actor.userId,
        now: now(),
      });
      if (!checked.ok) {
        return fail(checked.reason === "expired" ? "challenge_expired" : "challenge_invalid");
      }
      if (before?.lastChallengeNonce === checked.nonce) return fail("challenge_reused");

      // 3. The file must really be audio, and big enough to clone from.
      const sample = checkSample(input.sample);
      if (!sample.ok) {
        return fail(sample.reason === "too_small" ? "sample_too_short" : "sample_invalid");
      }
      const file = { bytes: input.sample, filename: sample.filename, mime: sample.mime };

      // 4. Hear the challenge words in the sample. Fails closed.
      let transcript: string;
      try {
        transcript = (await provider.transcribe(file)).text;
      } catch (error) {
        await event(actor, "clone_failed", { stage: "transcribe" });
        return fail(providerFailure(error));
      }
      if (wordCount(transcript) < MIN_SAMPLE_WORDS) {
        await event(actor, "clone_failed", { stage: "verify", reason: "too_short" });
        return fail("sample_too_short");
      }
      if (!transcriptHasChallenge(transcript, checked.words)) {
        await event(actor, "clone_failed", { stage: "verify", reason: "challenge" });
        return fail("challenge_failed");
      }

      // 5. Create the voice at the provider. The sample is not kept anywhere.
      let voiceId: string;
      try {
        ({ voiceId } = await provider.createVoice({
          name: `TradeCatch ${actor.organizationId}`.slice(0, 100),
          description: "Receptionist voice recorded and consented to by the business owner.",
          labels: { source: "tradecatch" },
          sample: file,
        }));
      } catch (error) {
        await event(actor, "clone_failed", { stage: "create" });
        return fail(providerFailure(error));
      }

      // 6. Record it. It does NOT go live: the owner must preview and activate.
      const at = now().toISOString();
      const oldVoiceId = before?.providerVoiceId ?? null;
      const saved = await mutate(actor.organizationId, (c) => ({
        ...c,
        mode: "standard",
        status: "ready",
        providerVoiceId: voiceId,
        consent: {
          statementVersion: input.consent.statementVersion,
          signerName: signer,
          acceptedByUserId: actor.userId,
          acceptedAt: at,
        },
        consentRevokedAt: null,
        consentRevokedBy: null,
        verifiedAt: at,
        previewedAt: null,
        activatedAt: null,
        lastChallengeNonce: checked.nonce,
      }));
      if (!saved) {
        // Could not record it: do not leave an unowned clone at the provider.
        await provider.deleteVoice(voiceId).catch(() => undefined);
        await event(actor, "clone_failed", { stage: "save" });
        return fail("provider_error");
      }

      // 7. A replaced voice must not linger at the provider.
      if (oldVoiceId && oldVoiceId !== voiceId) {
        await provider.deleteVoice(oldVoiceId).catch(() =>
          event(actor, "provider_cleanup_failed", { reason: "replaced" }),
        );
      }
      await event(actor, "consent_given", { statementVersion: input.consent.statementVersion });
      await event(actor, "clone_created");
      return { ok: true, status: view(saved, actor.plan) };
    },

    async preview(actor, locale) {
      if (!entitled(actor.plan)) return fail("not_entitled");
      if (!provider) return fail("unavailable");
      const record = await store.get(actor.organizationId);
      if (!record || record.status !== "ready" || !record.providerVoiceId) {
        return fail("no_voice");
      }
      if (record.consentRevokedAt || !record.consent) return fail("consent_revoked");

      let result: { audio: Uint8Array; contentType: string };
      try {
        result = await provider.synthesize({
          voiceId: record.providerVoiceId,
          // Fixed server-side text: the endpoint cannot be used as a free TTS service.
          text: PREVIEW_TEXT[locale],
          model: DEFAULT_TTS_MODEL,
        });
      } catch (error) {
        return fail(providerFailure(error));
      }

      if (!record.previewedAt) {
        const at = now().toISOString();
        await mutate(actor.organizationId, (c) =>
          c.providerVoiceId === record.providerVoiceId ? { ...c, previewedAt: at } : null,
        );
        await event(actor, "previewed");
      }
      return { ok: true, ...result };
    },

    async setMode(actor, mode) {
      if (mode === "standard") {
        // Switching back is always allowed: no plan, provider or consent needed.
        const record = await store.get(actor.organizationId);
        if (!record || record.mode === "standard") {
          return { ok: true, status: view(record, actor.plan) };
        }
        const next = await mutate(actor.organizationId, (c) => ({
          ...c,
          mode: "standard",
          activatedAt: null,
        }));
        await event(actor, "deactivated");
        return { ok: true, status: view(next ?? record, actor.plan) };
      }

      if (!entitled(actor.plan)) return fail("not_entitled");
      if (!provider) return fail("unavailable");
      const record = await store.get(actor.organizationId);
      if (!record || record.status !== "ready" || !record.providerVoiceId) {
        return fail("no_voice");
      }
      if (record.consentRevokedAt || !record.consent) return fail("consent_revoked");
      if (!record.previewedAt) return fail("not_previewed");

      const at = now().toISOString();
      const next = await mutate(actor.organizationId, (c) =>
        c.providerVoiceId === record.providerVoiceId && c.previewedAt && !c.consentRevokedAt
          ? { ...c, mode: "custom", activatedAt: at }
          : null,
      );
      if (!next) return fail("provider_error");
      await event(actor, "activated");
      return { ok: true, status: view(next, actor.plan) };
    },

    deleteVoice: (actor) => removeVoice(actor, "deleted"),
    revokeConsent: (actor) => removeVoice(actor, "consent_revoked"),

    async resolveForAgent(organizationId, plan) {
      try {
        const record = await store.get(organizationId);
        if (!isLive(record, plan) || !record?.providerVoiceId) return STANDARD_AGENT_VOICE;
        return {
          mode: "custom",
          provider: VOICE_PROVIDER,
          voiceId: record.providerVoiceId,
          model: DEFAULT_TTS_MODEL,
        };
      } catch {
        return STANDARD_AGENT_VOICE;
      }
    },

    async purgeOrganization(organizationId) {
      const record = await store.get(organizationId);
      if (!record) return true;
      if (record.providerVoiceId) {
        try {
          if (!provider) return false;
          await provider.deleteVoice(record.providerVoiceId);
        } catch {
          return false;
        }
      }
      await store.remove(organizationId);
      return true;
    },

    events(actor, limit) {
      return store.listEvents(actor.organizationId, limit);
    },
  };
}
