"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

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
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);

  const enrolling = state !== "unverified";
  const showCodeForm = !enrolling || setup !== null;

  async function generate() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { secret?: string; otpauth?: string };
      if (res.ok && body.secret && body.otpauth) setSetup({ secret: body.secret, otpauth: body.otpauth });
      else if (res.status === 409) setMessage(t("mfaAlreadyOn"));
      else if (res.status === 429) setMessage(t("mfaTooMany"));
      else setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.replace(/\s/g, "") }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setMessage(res.status === 429 ? t("mfaTooMany") : res.status === 401 || res.status === 400 ? t("mfaInvalid") : t("error"));
    } finally {
      setBusy(false);
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
          onClick={() => void generate()}
          className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {t("mfaGenerate")}
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
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
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
            className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {enrolling ? t("mfaConfirm") : t("mfaSubmit")}
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
