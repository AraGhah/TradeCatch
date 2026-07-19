import { useTranslations } from "next-intl";
import { Container } from "@/components/Container";

export function LegalDocument({
  title,
  sections,
}: {
  title: string;
  sections: { heading: string; body: string }[];
}) {
  const t = useTranslations("legal");

  return (
    <section className="bg-white py-16 sm:py-24">
      <Container className="max-w-3xl">
        <h1 className="text-3xl font-bold text-navy sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-text/70">
          {t("lastUpdated")}: {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
        </p>
        <p className="mt-4 rounded-md border border-dashed border-navy/20 bg-bg p-4 text-xs text-text/70">
          {t("reviewNotice")}
        </p>
        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <div key={section.heading}>
              <h2 className="text-lg font-semibold text-navy">{section.heading}</h2>
              <p className="mt-2 text-sm leading-relaxed text-text/80">{section.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
