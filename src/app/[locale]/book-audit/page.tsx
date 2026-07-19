import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { BookAuditForm } from "@/components/BookAuditForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "bookAudit" });
  return { title: t("headline"), description: t("intro") };
}

export default async function BookAuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("bookAudit");

  return (
    <section className="bg-white py-16 sm:py-24">
      <Container className="max-w-3xl">
        <SectionHeading title={t("headline")} intro={t("intro")} />
        <div className="mt-12">
          <BookAuditForm />
        </div>
      </Container>
    </section>
  );
}
