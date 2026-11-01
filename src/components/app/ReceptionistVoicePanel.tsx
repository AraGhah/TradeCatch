"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { VoiceRecorder } from "@/components/app/VoiceRecorder";
import { Link } from "@/i18n/navigation";
import type { VoiceStatusView } from "@/product/receptionist/custom-voice/model";

const API = "/api/app/receptionist/voice";

const KNOWN_ERRORS = new Set([
  "not_entitled",
  "unavailable",
  "consent_required",
  "consent_outdated",
  "challenge_invalid",
  "challenge_expired",
  "challenge_reused",
  "challenge_failed",
  "sample_invalid",
  "sample_too_short",
  "no_voice",
  "not_previewed",
  "consent_revoked",
  "provider_error",
  "forbidden",
]);

type Challenge = { token: string; words: string[]; expiresAt: string };
type Busy =
  | "challenge"
  | "clone"
  | "preview"
  | "activate"
  | "standard"
  | "delete"
  | "revoke"
  | null;

const CARD = "rounded-md border border-navy/10 bg-white px-5 py-4";
const H2 = "text-sm font-semibold uppercase tracking-[0.06em] text-navy/50";
const PRIMARY =
  "rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
  "rounded-md border border-navy/20 bg-white px-3 py-2 text-sm font-semibold text-navy disabled:cursor-not-allowed disabled:opacity-50";
const DANGER =
  "rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Receptionist Voice settings: choose the standard voice or your own cloned
 * voice, record a sample, listen to a preview, and delete the voice or withdraw
 * consent. The server decides everything that matters (plan, consent,
 * verification, preview-before-live): this component only collects the input
 * and shows what the server says. It never sees the provider's voice id.
 */
export function ReceptionistVoicePanel({
  initialStatus,
  canManage,
}: {
  initialStatus: VoiceStatusView;
  canManage: boolean;
}) {
  const t = useTranslations("app.voice");
  const locale = useLocale() === "fr" ? "fr" : "en";

  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<Busy>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [agreed, setAgreed] = useState(false);
  const [signer, setSigner] = useState("");
  const [consentVersion, setConsentVersion] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [sample, setSample] = useState<File | null>(null);
  const [recordAgain, setRecordAgain] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "revoke" | null>(null);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  function fail(code: unknown) {
    setNotice(null);
    setErrorCode(typeof code === "string" && KNOWN_ERRORS.has(code) ? code : "generic");
  }

  async function request(
    path: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; data: Record<string, unknown> | null; res: Response }> {
    const res = await fetch(`${API}${path}`, { credentials: "same-origin", ...init });
    const data = res.headers.get("content-type")?.includes("application/json")
      ? ((await res.json().catch(() => null)) as Record<string, unknown> | null)
      : null;
    return { ok: res.ok, data, res };
  }

  const json = (body: unknown): RequestInit => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  function applyStatus(data: Record<string, unknown> | null) {
    const next = data?.status as VoiceStatusView | undefined;
    if (next) setStatus(next);
  }

  async function run(
    kind: Exclude<Busy, null>,
    work: () => Promise<{ ok: boolean; data: Record<string, unknown> | null } | void>,
    success?: string,
  ) {
    setBusy(kind);
    setErrorCode(null);
    setNotice(null);
    try {
      const result = await work();
      if (result && !result.ok) {
        fail(result.data?.code);
        return false;
      }
      if (success) setNotice(success);
      return true;
    } catch {
      fail("generic");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const nameOk = signer.trim().length >= 2;

  async function startRecording() {
    await run("challenge", async () => {
      const result = await request("/challenge", { method: "POST", ...json({ locale }) });
      if (result.ok && result.data) {
        setChallenge(result.data.challenge as Challenge);
        setConsentVersion(String(result.data.consentVersion));
        setSample(null);
      }
      return result;
    });
  }

  async function createVoice() {
    if (!challenge || !sample || !consentVersion) return;
    const done = await run(
      "clone",
      async () => {
        const form = new FormData();
        form.set("consentAccepted", "true");
        form.set("consentVersion", consentVersion);
        form.set("signerName", signer.trim());
        form.set("challengeToken", challenge.token);
        form.set("sample", sample, sample.name);
        const result = await request("/clone", { method: "POST", body: form });
        if (result.ok) applyStatus(result.data);
        return result;
      },
      t("notices.created"),
    );
    if (done) {
      setChallenge(null);
      setSample(null);
      setAgreed(false);
      setRecordAgain(false);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
      setPreviewUrl(null);
    }
    // On failure the words and the recording stay, so a retry does not mean
    // re-recording. An expired or used-up challenge offers "new text" instead.
  }

  async function preview() {
    await run("preview", async () => {
      const res = await fetch(`${API}/preview`, {
        method: "POST",
        credentials: "same-origin",
        ...json({ locale }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        return { ok: false, data };
      }
      const blob = await res.blob();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = URL.createObjectURL(blob);
      setPreviewUrl(previewRef.current);
      // The server records that a preview was made; refresh what it says.
      const fresh = await request("", { method: "GET" });
      if (fresh.ok) applyStatus(fresh.data);
      return { ok: true, data: null };
    });
  }

  async function setMode(mode: "custom" | "standard") {
    await run(
      mode === "custom" ? "activate" : "standard",
      async () => {
        const result = await request("", { method: "PUT", ...json({ mode }) });
        if (result.ok) applyStatus(result.data);
        return result;
      },
      mode === "custom" ? t("notices.activated") : t("notices.standard"),
    );
  }

  async function remove(kind: "delete" | "revoke") {
    const ok = await run(kind, async () => {
      const result =
        kind === "delete"
          ? await request("", { method: "DELETE" })
          : await request("/revoke", { method: "POST" });
      if (result.ok) {
        applyStatus(result.data);
        const next = result.data?.status as VoiceStatusView | undefined;
        setNotice(next?.cleanupPending ? t("notices.cleanupPending") : t(`notices.${kind}`));
      }
      return result;
    });
    if (ok) {
      setConfirm(null);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
      setPreviewUrl(null);
    }
  }

  const disabled = busy !== null || !canManage;
  const showSetup = !status.hasVoice || recordAgain;

  /* ---------------------------------------------------------------- */

  if (!status.entitled) {
    return (
      <div className="flex flex-col gap-4">
        <aside className={CARD} data-testid="voice-locked">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-orange">
            {t("locked.badge")}
          </p>
          <p className="mt-1 text-base font-semibold text-navy">{t("locked.title")}</p>
          <p className="mt-1 text-sm text-navy/70">{t("locked.body")}</p>
          <Link
            href="/pricing"
            className="mt-3 inline-flex text-sm font-semibold text-orange underline-offset-2 hover:underline"
          >
            {t("locked.cta")}
          </Link>
        </aside>
        {status.hasVoice || status.cleanupPending ? (
          <section className={CARD}>
            <p className="text-sm text-navy/80">{t("locked.existing")}</p>
            {canManage ? (
              <DeleteControls
                t={t}
                confirm={confirm}
                setConfirm={setConfirm}
                busy={busy}
                remove={remove}
                showRevoke={false}
              />
            ) : null}
            <Feedback t={t} errorCode={errorCode} notice={notice} />
          </section>
        ) : null}
      </div>
    );
  }

  if (!status.available && !status.hasVoice) {
    return (
      <p className={CARD} role="status">
        {t("unavailable")}
      </p>
    );
  }

  const words = challenge?.words ?? [];
  const script = challenge
    ? t("record.script", {
        word1: words[0] ?? "",
        word2: words[1] ?? "",
        word3: words[2] ?? "",
      })
    : "";

  return (
    <div className="flex flex-col gap-6">
      {/* Which voice answers */}
      <section aria-labelledby="voice-current" className={`${CARD} flex flex-col gap-3`}>
        <h2 id="voice-current" className={H2}>
          {t("current.title")}
        </h2>
        <p
          className="text-base font-semibold text-navy"
          role="status"
          data-testid="voice-live-state"
        >
          {status.live ? t("current.liveCustom") : t("current.liveStandard")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div
            className={`rounded-md border px-4 py-3 ${
              status.mode === "standard" ? "border-navy bg-navy/[0.03]" : "border-navy/15"
            }`}
          >
            <p className="text-sm font-semibold text-navy">{t("current.standard.title")}</p>
            <p className="mt-1 text-sm text-navy/70">{t("current.standard.body")}</p>
            {status.mode === "custom" && canManage ? (
              <button
                type="button"
                className={`${SECONDARY} mt-3`}
                disabled={disabled}
                onClick={() => setMode("standard")}
              >
                {t("current.switchBack")}
              </button>
            ) : null}
          </div>
          <div
            className={`rounded-md border px-4 py-3 ${
              status.mode === "custom" ? "border-navy bg-navy/[0.03]" : "border-navy/15"
            }`}
          >
            <p className="text-sm font-semibold text-navy">{t("current.custom.title")}</p>
            <p className="mt-1 text-sm text-navy/70">{t("current.custom.body")}</p>
            {status.mode !== "custom" ? (
              <p className="mt-2 text-sm text-navy/60">
                {!status.hasVoice
                  ? t("current.needsVoice")
                  : !status.previewed
                    ? t("current.needsPreview")
                    : null}
              </p>
            ) : null}
            {status.mode !== "custom" && status.hasVoice && canManage ? (
              <button
                type="button"
                className={`${PRIMARY} mt-3`}
                disabled={disabled || !status.previewed}
                onClick={() => setMode("custom")}
              >
                {t("current.activate")}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* A voice exists: preview and manage */}
      {status.hasVoice ? (
        <section aria-labelledby="voice-yours" className={`${CARD} flex flex-col gap-3`}>
          <h2 id="voice-yours" className={H2}>
            {t("yours.title")}
          </h2>
          {status.consent ? (
            <p className="text-sm text-navy/70">
              {t("yours.consent", {
                name: status.consent.signerName,
                date: new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
                  dateStyle: "medium",
                }).format(new Date(status.consent.acceptedAt)),
              })}
            </p>
          ) : null}
          {status.consent?.outdated ? (
            <p className="text-sm text-navy/70">{t("yours.outdated")}</p>
          ) : null}
          <p className="text-sm text-navy/70">{t("preview.intro")}</p>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={PRIMARY} disabled={disabled} onClick={preview}>
                {busy === "preview" ? t("preview.loading") : t("preview.button")}
              </button>
              <button
                type="button"
                className={SECONDARY}
                disabled={disabled}
                onClick={() => setRecordAgain((v) => !v)}
              >
                {recordAgain ? t("yours.cancelRecordAgain") : t("yours.recordAgain")}
              </button>
            </div>
          ) : null}
          {previewUrl ? (
            <audio controls autoPlay src={previewUrl} className="w-full max-w-md" />
          ) : null}
          {status.previewed ? (
            <p className="text-sm text-navy/60">{t("preview.done")}</p>
          ) : null}
        </section>
      ) : null}

      {/* Record a voice */}
      {showSetup && canManage && status.available ? (
        <section aria-labelledby="voice-setup" className={`${CARD} flex flex-col gap-5`}>
          <h2 id="voice-setup" className={H2}>
            {recordAgain ? t("setup.titleAgain") : t("setup.title")}
          </h2>
          <p className="text-sm text-navy/70">{t("setup.intro")}</p>

          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="mb-1 p-0 text-sm font-semibold text-navy">
              {t("consent.title")}
            </legend>
            <p
              className="rounded-md border-l-2 border-orange bg-orange/5 px-4 py-3 text-sm leading-relaxed text-navy"
              data-testid="voice-consent-text"
            >
              {t("consent.statement")}
            </p>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-navy">
              <input
                type="checkbox"
                className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-orange"
                checked={agreed}
                disabled={disabled || challenge !== null}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>{t("consent.accept")}</span>
            </label>
            <label className="text-sm text-navy">
              {t("consent.signerLabel")}
              <input
                type="text"
                autoComplete="name"
                maxLength={120}
                value={signer}
                disabled={disabled || challenge !== null}
                onChange={(e) => setSigner(e.target.value)}
                className="mt-1 block w-full max-w-sm rounded-md border border-navy/15 px-2 py-2"
              />
              <span className="mt-1 block text-xs text-navy/60">{t("consent.signerHint")}</span>
            </label>
            {!challenge ? (
              <button
                type="button"
                className={`${PRIMARY} w-fit`}
                disabled={disabled || !agreed || !nameOk}
                onClick={startRecording}
              >
                {busy === "challenge" ? t("record.preparing") : t("record.getText")}
              </button>
            ) : null}
          </fieldset>

          {challenge ? (
            <div className="flex flex-col gap-3" data-testid="voice-record-step">
              <h3 className="text-sm font-semibold text-navy">{t("record.title")}</h3>
              <p className="text-sm text-navy/70">{t("record.wordsIntro")}</p>
              <p className="flex flex-wrap gap-2" aria-label={t("record.wordsLabel")}>
                {words.map((word) => (
                  <span
                    key={word}
                    className="rounded-full bg-navy px-3 py-1 text-sm font-semibold text-white"
                  >
                    {word}
                  </span>
                ))}
              </p>
              <blockquote className="m-0 rounded-md border border-navy/10 bg-navy/[0.03] px-4 py-3 text-sm leading-relaxed text-navy">
                {script}
              </blockquote>
              <p className="text-xs text-navy/60">{t("record.tips")}</p>
              <VoiceRecorder disabled={disabled} onSample={setSample} />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={PRIMARY}
                  disabled={disabled || !sample}
                  onClick={createVoice}
                >
                  {busy === "clone" ? t("create.creating") : t("create.button")}
                </button>
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={disabled}
                  onClick={() => {
                    setChallenge(null);
                    setSample(null);
                  }}
                >
                  {t("create.cancel")}
                </button>
                {errorCode === "challenge_expired" ||
                errorCode === "challenge_reused" ||
                errorCode === "challenge_invalid" ? (
                  <button
                    type="button"
                    className={SECONDARY}
                    disabled={disabled}
                    onClick={startRecording}
                  >
                    {t("record.newText")}
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-navy/60">{t("create.privacy")}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Delete / withdraw */}
      {status.hasVoice || status.cleanupPending ? (
        <section aria-labelledby="voice-remove" className={`${CARD} flex flex-col gap-3`}>
          <h2 id="voice-remove" className={H2}>
            {t("remove.title")}
          </h2>
          <p className="text-sm text-navy/70">{t("remove.intro")}</p>
          {status.cleanupPending ? (
            <p className="text-sm text-navy" role="status">
              {t("notices.cleanupPending")}
            </p>
          ) : null}
          {canManage ? (
            <DeleteControls
              t={t}
              confirm={confirm}
              setConfirm={setConfirm}
              busy={busy}
              remove={remove}
              showRevoke
            />
          ) : null}
        </section>
      ) : null}

      {status.consentRevokedAt && !status.hasVoice ? (
        <p className="text-sm text-navy/60">
          {t("remove.revokedOn", {
            date: new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
              dateStyle: "medium",
            }).format(new Date(status.consentRevokedAt)),
          })}
        </p>
      ) : null}

      <Feedback t={t} errorCode={errorCode} notice={notice} />
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

function Feedback({
  t,
  errorCode,
  notice,
}: {
  t: T;
  errorCode: string | null;
  notice: string | null;
}) {
  return (
    <div aria-live="polite" className="min-h-5">
      {errorCode ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {t(`errors.${errorCode}`)}
        </p>
      ) : null}
      {notice ? <p className="text-sm font-medium text-navy">{notice}</p> : null}
    </div>
  );
}

/** Two-step buttons: the first press asks, the second one does it (no browser dialog). */
function DeleteControls({
  t,
  confirm,
  setConfirm,
  busy,
  remove,
  showRevoke,
}: {
  t: T;
  confirm: "delete" | "revoke" | null;
  setConfirm: (value: "delete" | "revoke" | null) => void;
  busy: Busy;
  remove: (kind: "delete" | "revoke") => void;
  showRevoke: boolean;
}) {
  const working = busy === "delete" || busy === "revoke";
  if (confirm) {
    return (
      <div className="flex flex-col gap-3" role="group" aria-label={t(`remove.${confirm}.confirmTitle`)}>
        <p className="text-sm font-semibold text-navy">{t(`remove.${confirm}.confirmBody`)}</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={DANGER}
            disabled={working}
            onClick={() => remove(confirm)}
          >
            {working ? t("remove.working") : t(`remove.${confirm}.confirmButton`)}
          </button>
          <button
            type="button"
            className={SECONDARY}
            disabled={working}
            onClick={() => setConfirm(null)}
          >
            {t("remove.keep")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-3">
      <button type="button" className={DANGER} disabled={busy !== null} onClick={() => setConfirm("delete")}>
        {t("remove.delete.button")}
      </button>
      {showRevoke ? (
        <button type="button" className={DANGER} disabled={busy !== null} onClick={() => setConfirm("revoke")}>
          {t("remove.revoke.button")}
        </button>
      ) : null}
    </div>
  );
}
