"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { CTAButton } from "@/components/CTAButton";

const SESSION_KEY = "tradecatch-error-session";

function getOrCreateSessionId(): string | undefined {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing.slice(0, 64);
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s_${Date.now()}`;
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id.slice(0, 64);
  } catch {
    return undefined;
  }
}

async function reportClientError(error: Error & { digest?: string }) {
  try {
    await fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: String(error.message ?? "client_error").slice(0, 300),
        digest: error.digest?.slice(0, 80),
        // Prefer digest over full stacks — API sanitizes further if present.
        stack: error.digest ? undefined : error.stack?.slice(0, 800),
        path: typeof window !== "undefined" ? window.location.pathname : null,
        buildId: process.env.NEXT_PUBLIC_BUILD_ID?.slice(0, 64),
        sessionId: getOrCreateSessionId(),
      }),
      keepalive: true,
    });
  } catch {
    // Never block recovery UI on monitoring failure.
  }
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error("[app-error]", error);
    void reportClientError(error);
  }, [error]);

  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center bg-paper px-[clamp(20px,4vw,40px)] py-20 text-center">
      <p className="text-mono-label text-muted">{t("eyebrow")}</p>
      <h1 className="text-page-hero mt-4 max-w-[16em] text-navy">
        {t("headline")}
      </h1>
      <p className="text-lede mt-5 max-w-[32em] text-muted">
        {t.rich("support", {
          phone: (chunks) => (
            <a href="tel:4389936997" className="font-semibold text-ember-text">
              {chunks}
            </a>
          ),
        })}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="rounded-[11px] bg-orange px-[22px] py-[14px] text-[15px] font-semibold text-navy shadow-cta transition-colors hover:bg-orange-dark"
        >
          {t("retry")}
        </button>
        <CTAButton href="/" variant="secondary">
          {t("home")}
        </CTAButton>
      </div>
    </section>
  );
}
