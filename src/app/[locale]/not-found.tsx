import { useTranslations } from "next-intl";
import { Container } from "@/components/Container";
import { CTAButton } from "@/components/CTAButton";

export default function NotFound() {
  const t = useTranslations("notFound");

  return (
    <section className="py-24">
      <Container className="text-center">
        <h1 className="text-3xl font-bold text-navy">{t("title")}</h1>
        <p className="mt-4 text-text/80">{t("body")}</p>
        <div className="mt-8">
          <CTAButton href="/">{t("cta")}</CTAButton>
        </div>
      </Container>
    </section>
  );
}
