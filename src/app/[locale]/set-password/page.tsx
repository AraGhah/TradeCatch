import { getTranslations, setRequestLocale } from "next-intl/server";
import { SetPasswordForm } from "@/components/app/SetPasswordForm";
import { Container } from "@/components/Container";
import { FullMessagesProvider } from "@/components/FullMessagesProvider";
import { Link } from "@/i18n/navigation";
import { inspectPasswordToken } from "@/product/saas/auth/password-auth";

export const dynamic = "force-dynamic";
// The link is a secret: keep it out of search results and out of Referer headers.
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function SetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { token } = await searchParams;
  const raw = typeof token === "string" ? token.trim() : "";
  const t = await getTranslations("setPassword");
  // Reading the page never spends the link; only saving a password does.
  const check = raw ? await inspectPasswordToken(raw) : { valid: false as const };

  return (
    <section className="border-b border-navy/10 bg-[var(--color-surface)] py-16 md:py-24">
      <Container>
        <div className="mx-auto max-w-lg text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-ember-text">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-archivo)] text-3xl font-extrabold tracking-tight text-navy md:text-4xl">
            {check.valid
              ? check.kind === "activation"
                ? t("headlineActivation")
                : t("headlineReset")
              : t("headlineReset")}
          </h1>
          <p className="mt-3 text-base text-navy/70">
            {check.valid
              ? check.kind === "activation"
                ? t("introActivation")
                : t("introReset")
              : t("invalidLink")}
          </p>
        </div>
        <div className="mt-10">
          {check.valid ? (
            <FullMessagesProvider>
              <SetPasswordForm token={raw} />
            </FullMessagesProvider>
          ) : (
            <p className="text-center text-sm">
              <Link
                href="/forgot-password"
                className="font-semibold text-navy underline"
              >
                {t("requestNew")}
              </Link>
            </p>
          )}
        </div>
      </Container>
    </section>
  );
}
