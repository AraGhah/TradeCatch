import { useTranslations } from "next-intl";

/**
 * Shown in the content area (the menu stays) while a dashboard page loads. The
 * blocks hold the place of the page so it does not jump; the words are for
 * screen readers, and take no space so the layout is the same with or without them.
 */
export default function AppLoading() {
  const t = useTranslations("feedback");
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p role="status" className="sr-only">
        {t("loading")}
      </p>
      <div aria-hidden="true" className="contents">
        <div className="h-8 w-56 animate-pulse rounded-md bg-navy/10" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded-md bg-navy/10" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl bg-white" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-white" />
        <div className="h-48 animate-pulse rounded-xl bg-white" />
      </div>
    </div>
  );
}
