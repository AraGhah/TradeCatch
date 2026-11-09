import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm, type LoginNotice } from "@/components/app/LoginForm";
import { Container } from "@/components/Container";
import { FullMessagesProvider } from "@/components/FullMessagesProvider";
import { safeReturnPath } from "@/product/saas/auth/return-path";

/** Turns the code a sign-in route put in the address into one of our own messages. */
function noticeFrom(
  error: string | undefined,
  notice: string | undefined,
): LoginNotice | null {
  if (notice === "password_saved") return "passwordSaved";
  if (!error) return null;
  return error === "rate_limited" ? "linkRateLimited" : "linkInvalid";
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    error?: string | string[];
    notice?: string | string[];
    next?: string | string[];
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("login");
  const query = await searchParams;
  const notice = noticeFrom(
    typeof query.error === "string" ? query.error : undefined,
    typeof query.notice === "string" ? query.notice : undefined,
  );

  // Where to go after signing in. Only our own workspace pages are accepted.
  const returnTo = safeReturnPath(
    typeof query.next === "string" ? query.next : undefined,
  );

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
            <LoginForm notice={notice} returnTo={returnTo} />
          </FullMessagesProvider>
        </div>
      </Container>
    </section>
  );
}
