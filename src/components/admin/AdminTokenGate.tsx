"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { timedFetch } from "@/lib/client/timed-fetch";
import { InlineStatus } from "@/components/ui/Spinner";

export function AdminTokenGate() {
  const t = useTranslations("admin.platform");
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await timedFetch("/api/auth/admin-token", { method: "POST" });
        if (cancelled) return;
        if (res.ok) router.refresh();
        else setFailed(true);
      } catch {
        // Offline or no answer in time: show the error instead of waiting forever.
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (failed) {
    return (
      <p role="alert" className="text-sm text-navy/70">
        {t("tokenError")}
      </p>
    );
  }
  return <InlineStatus>{t("tokenWait")}</InlineStatus>;
}
