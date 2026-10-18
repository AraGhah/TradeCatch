"use client";

import { useTranslations } from "next-intl";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("app.home");
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-6">
      <h1 className="font-[family-name:var(--font-archivo)] text-xl font-extrabold text-navy">
        {t("loadErrorTitle")}
      </h1>
      <p className="mt-2 text-sm text-navy/80">{t("loadErrorBody")}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-4 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white"
      >
        {t("retry")}
      </button>
    </div>
  );
}
