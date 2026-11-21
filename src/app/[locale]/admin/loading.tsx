import { useTranslations } from "next-intl";

/** Placeholder blocks while an admin page loads; the words are for screen readers only and take no space. */
export default function AdminLoading() {
  const t = useTranslations("feedback");
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      <p role="status" className="sr-only">
        {t("loading")}
      </p>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} aria-hidden className="h-24 animate-pulse rounded-md bg-navy/5" />
      ))}
    </div>
  );
}
