import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { AppShell } from "@/components/app/AppShell";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const auth = await requireTenantContext();
  if (!auth.ok) {
    redirect(locale === "fr" ? "/fr/connexion" : "/login");
  }

  return (
    <AppShell
      orgName={auth.ctx.organization.name}
      plan={auth.ctx.organization.plan}
      userName={auth.ctx.user.name}
      locale={locale === "fr" ? "fr" : "en"}
    >
      {children}
    </AppShell>
  );
}
