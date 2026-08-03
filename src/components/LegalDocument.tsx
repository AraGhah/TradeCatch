import { useLocale, useTranslations } from "next-intl";
import { Container } from "@/components/Container";

// Bump this only when the legal copy itself changes — not on every deploy.
const LEGAL_EFFECTIVE_DATE = "2026-08-02";

export function LegalDocument({
  title,
  sections,
}: {
  title: string;
  sections: { heading: string; body: string }[];
}) {
  const t = useTranslations("legal");
  const locale = useLocale();
  const formattedDate = new Date(LEGAL_EFFECTIVE_DATE).toLocaleDateString(
    locale,
    { year: "numeric", month: "long", day: "numeric" },
  );

  return (
    <section className="bg-surface py-16 sm:py-24">
      <Container className="max-w-3xl">
        <h1 className="text-3xl font-bold text-heading sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-text/70">
          {t("lastUpdated")}: {formattedDate}
        </p>
        <p className="mt-4 rounded-md border border-dashed border-[rgb(var(--ink-rgb)/0.2)] bg-bg p-4 text-xs text-text/70">
          {t("reviewNotice")}
        </p>
        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <div key={section.heading}>
              <h2 className="text-lg font-semibold text-heading">{section.heading}</h2>
              <p className="mt-2 text-sm leading-relaxed text-text/80">{section.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
