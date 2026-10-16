import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireTenantContext } from "@/product/saas/tenant";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { LivePhoneTesting } from "@/components/app/LivePhoneTesting";

export default async function LivePhoneTestingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.livePhoneTesting");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const profile = await getReceptionistRuntime().profileStore.getProfile(
    auth.ctx.organization.id,
  );
  const dialNumber =
    profile?.settings.phoneSettings?.tradecatchNumberE164 ||
    profile?.phoneNumberE164 ||
    auth.ctx.organization.phoneE164;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-navy/50">
          <Link href="/app/test-center" className="hover:underline">
            {t("back")}
          </Link>
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
      </header>
      <LivePhoneTesting
        organizationId={auth.ctx.organization.id}
        dialNumber={dialNumber}
      />
    </div>
  );
}
