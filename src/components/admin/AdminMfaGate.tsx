"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { BusyLabel } from "@/components/ui/Spinner";
import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
type GateState = "unenrolled" | "pending" | "unverified";

function groupKey(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Administrator second factor. Everyone on the administrator list passes
 * through here on every new sign-in: first to enroll an authenticator, then to
 * enter a code. Nothing in the admin console renders until this is satisfied.
 */
export function AdminMfaGate({
  organizationId,
  state,
}: {
  organizationId: string;
  state: GateState;
}) {
  const t = useTranslations("admin.platform");
  const endpoint = `/api/businesses/${organizationId}/security/mfa`;
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // Which request is running, so only that button shows its busy words.
  const [running, setRunning] = useState<"generate" | "verify" | null>(null);
  const busy = running !== null;
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);

  const enrolling = state !== "unverified";
  const showCodeForm = !enrolling || setup !== null;

  const generate = useGuarded(generateHandler);
  async function generateHandler() {
    setRunning("generate");
    setMessage(null);
    try {
      const res = await timedFetch(endpoint, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { secret?: string; otpauth?: string };
      if (res.ok && body.secret && body.otpauth) setSetup({ secret: body.secret, otpauth: body.otpauth });
      else if (res.status === 409) setMessage(t("mfaAlreadyOn"));
      else if (res.status === 429) setMessage(t("mfaTooMany"));
      else setMessage(t("error"));
    } catch {
      // No answer (offline, or no reply in time): no key was shown, so there is nothing to lose by trying again.
      setMessage(t("mfaNoAnswer"));
    } finally {
      setRunning(null);
    }
  }

  const submit = useGuarded(submitHandler);
  async function submitHandler(event: FormEvent) {
    event.preventDefault();
    setRunning("verify");
    setMessage(null);
    // Once verification succeeded the page reloads; the button stays busy until it does, so a second click cannot start a second verification.
    let leaving = false;
    try {
      const res = await timedFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.replace(/\s/g, "") }),
      });
      if (res.ok) {
        leaving = true;
        window.location.reload();
        return;
      }
      setMessage(res.status === 429 ? t("mfaTooMany") : res.status === 401 || res.status === 400 ? t("mfaInvalid") : t("error"));
    } catch {
      setMessage(t("mfaNoAnswer"));
    } finally {
      if (!leaving) setRunning(null);
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
        {enrolling ? t("mfaSetupTitle") : t("mfaTitle")}
      </h1>
      <p className="text-sm text-navy/70">{enrolling ? t("mfaSetupBody") : t("mfaBody")}</p>

      {enrolling && !setup ? (
        <button
          type="button"
          disabled={busy}
          aria-busy={running === "generate"}
          onClick={() => void generate()}
          className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          <BusyLabel pending={running === "generate"} busyLabel={t("mfaGenerating")}>
            {t("mfaGenerate")}
          </BusyLabel>
        </button>
      ) : null}

      {setup ? (
        <div className="flex flex-col gap-2 rounded-md bg-navy/5 p-3 text-sm text-navy">
          <span className="text-navy/70">{t("mfaKeyLabel")}</span>
          <code className="select-all break-all font-mono text-base tracking-wider">{groupKey(setup.secret)}</code>
          <a className="w-fit underline" href={setup.otpauth}>
            {t("mfaOpenApp")}
          </a>
        </div>
      ) : null}

      {showCodeForm ? (
        <form onSubmit={(event) => void submit(event)} aria-busy={running === "verify"} className="flex flex-col gap-3">
          <label className="text-sm text-navy/70">
            {t("mfaCode")}
            <input
              inputMode="numeric"
              pattern="[0-9 ]*"
              maxLength={7}
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="mt-1 block rounded-md border border-navy/15 px-2 py-1.5"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            aria-busy={running === "verify"}
            className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <BusyLabel pending={running === "verify"} busyLabel={t("mfaVerifying")}>
              {enrolling ? t("mfaConfirm") : t("mfaSubmit")}
            </BusyLabel>
          </button>
        </form>
      ) : null}

      {message ? (
        <p role="alert" className="text-sm text-navy">
          {message}
        </p>
      ) : null}
    </div>
  );
}
