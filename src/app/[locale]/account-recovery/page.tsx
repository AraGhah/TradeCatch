import { getTranslations, setRequestLocale } from "next-intl/server";
import { AccountRecoveryForm } from "@/components/app/AccountRecoveryForm";
import { Container } from "@/components/Container";
import { FullMessagesProvider } from "@/components/FullMessagesProvider";

export const metadata = { robots: { index: false, follow: false } };

export default async function AccountRecoveryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("accountRecovery");

  return (
    <section className="border-b border-navy/10 bg-[var(--color-surface)] py-16 md:py-24">
      <Container>
        <div className="mx-auto max-w-lg text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-ember-text">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-archivo)] text-3xl font-extrabold tracking-tight text-navy md:text-4xl">
            {t("headline")}
          </h1>
          <p className="mt-3 text-base text-navy/70">{t("intro")}</p>
        </div>
        <div className="mt-10">
          <FullMessagesProvider>
            <AccountRecoveryForm />
          </FullMessagesProvider>
        </div>
      </Container>
    </section>
  );
}
