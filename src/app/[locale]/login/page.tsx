import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "@/components/app/LoginForm";
import { Container } from "@/components/Container";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("login");

  return (
    <section className="border-b border-navy/10 bg-[var(--color-surface)] py-16 md:py-24">
      <Container>
        <div className="mx-auto max-w-lg text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-orange">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-archivo)] text-3xl font-extrabold tracking-tight text-navy md:text-4xl">
            {t("headline")}
          </h1>
          <p className="mt-3 text-base text-navy/70">{t("intro")}</p>
        </div>
        <div className="mt-10">
          <LoginForm />
        </div>
      </Container>
    </section>
  );
}
