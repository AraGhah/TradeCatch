import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BusinessControls } from "@/components/admin/BusinessControls";
import { Link } from "@/i18n/navigation";
import { formatPlanMoney } from "@/lib/plans";
import { loadPlatformSnapshot } from "@/product/admin/platform-snapshot";
import { getSecurityService } from "@/product/security/runtime";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

export default async function AdminBusinessPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.platform");
  const store = getSaasStore();
  const org = await store.getOrganization(id);
  if (!org) notFound();
  const members = await store.listMembershipsForOrganization(id);
  const users = await store.listUsers(members.map((member) => member.userId));
  const byId = new Map(users.map((user) => [user.id, user]));
  const snapshot = await loadPlatformSnapshot();
  const usage = snapshot.rows.find((row) => row.id === id);
  let recording = false;
  try {
    recording = (await getSecurityService().recording(id)).recordingEnabled;
  } catch {
    recording = false;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{org.name}</h1>
        <p className="mt-2 text-sm text-navy/70">{t("noPassword")}</p>
      </header>
      <section className="rounded-md border border-navy/10 bg-white p-4 text-sm text-navy">
        <h2 className="font-semibold">{t("profile")}</h2>
        <p className="mt-2">{org.plan} · {org.status} · {formatPlanMoney(usage?.monthly ?? 0, locale)}</p>
        <p>{[org.city, org.industry, org.phoneE164].filter(Boolean).join(" · ")}</p>
        <p className="mt-2">{recording ? t("recordingOn") : t("recordingOff")}</p>
        <Link href="/admin/support" className="mt-3 inline-block underline">{t("supportLink")}</Link>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        <p className="rounded-md border border-navy/10 bg-white px-4 py-3 text-sm">{t("leads")}: {usage?.leads ?? 0}</p>
        <p className="rounded-md border border-navy/10 bg-white px-4 py-3 text-sm">{t("calls")}: {usage?.calls ?? 0}</p>
        <p className="rounded-md border border-navy/10 bg-white px-4 py-3 text-sm">{t("appointments")}: {usage?.appointments ?? 0}</p>
      </section>
      <BusinessControls
        organizationId={org.id}
        status={org.status}
        members={members.map((member) => ({
          userId: member.userId,
          name: byId.get(member.userId)?.name ?? "",
          email: byId.get(member.userId)?.email ?? "",
          role: member.role,
        }))}
      />
    </div>
  );
}
