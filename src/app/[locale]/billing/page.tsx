import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireBillingContext } from "@/product/saas/tenant";
import { BillingPortalButton } from "@/components/app/BillingPortalButton";
import { Link } from "@/i18n/navigation";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function BillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.account");
  const access = await requireBillingContext();
  if (!access.ok && access.status === 401) {
    redirect(locale === "fr" ? "/fr/connexion" : "/login");
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-12">
      <h1 className="text-2xl font-bold text-navy">{t("billingHeadline")}</h1>
      {access.ok ? (
        <>
          <p className="text-navy/80">
            {access.ctx.organization.status === "active"
              ? t("billingActive")
              : t("billingRecovery")}
          </p>
          <BillingPortalButton />
          {access.ctx.organization.status === "active" ? (
            <Link href="/app" className="text-navy underline">
              {t("billingBack")}
            </Link>
          ) : null}
        </>
      ) : (
        <p role="alert">{t("billingNoPermission")}</p>
      )}
      <Link href="/help" className="text-navy underline">
        {t("billingSupport")}
      </Link>
    </div>
  );
}
