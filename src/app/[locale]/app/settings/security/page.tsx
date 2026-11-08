import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { SecurityPanel } from "@/components/app/SecurityPanel";
import { PasswordSettings } from "@/components/app/PasswordSettings";
import { hasPassword } from "@/product/saas/auth/password-auth";

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.security");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  const passwordChosen = await hasPassword(auth.ctx.user.id);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("headline")}</h1>
      <p className="max-w-2xl text-sm text-navy/70">{t("intro")}</p>
      {passwordChosen === null ? null : (
        <PasswordSettings email={auth.ctx.user.email} hasPassword={passwordChosen} />
      )}
      <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">{t("sessions")}</h2>
      <SecurityPanel organizationId={auth.ctx.organization.id} isAdmin={auth.ctx.isPlatformAdminIdentity} locale={locale === "fr" ? "fr" : "en"} />
      {auth.ctx.isPlatformAdminIdentity ? <p className="text-sm text-navy/70">{t("mfaHint")}</p> : null}
    </div>
  );
}
