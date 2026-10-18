"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function AdminTokenGate() {
  const t = useTranslations("admin.platform");
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/auth/admin-token", { method: "POST" });
      if (cancelled) return;
      if (res.ok) router.refresh();
      else setFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return <p className="text-sm text-navy/70">{failed ? t("tokenError") : t("tokenWait")}</p>;
}
