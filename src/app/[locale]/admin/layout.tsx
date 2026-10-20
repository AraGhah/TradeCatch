import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AdminMfaGate } from "@/components/admin/AdminMfaGate";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminTokenGate } from "@/components/admin/AdminTokenGate";
import { readMatchingAdminJwt } from "@/lib/admin-auth";
import { isPlatformAdminUser } from "@/product/saas/platform-admin";
import { requireTenantContext } from "@/product/saas/tenant";
import { getSecurityService } from "@/product/security/runtime";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
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
  if (!isPlatformAdminUser(auth.ctx.user)) {
    redirect(locale === "fr" ? "/fr/app" : "/app");
  }
  const mfaState = await getSecurityService().mfaState(
    auth.ctx.user.id,
    auth.ctx.session.id,
  );
  const verified = mfaState === "verified";
  let tokenReady = false;
  if (verified) {
    tokenReady = Boolean(
      await readMatchingAdminJwt(
        auth.ctx.user.id,
        auth.ctx.session.id,
        15 * 60 * 1000,
      ),
    );
  }

  return (
    <div className="min-h-[70vh] border-b border-navy/10 bg-[var(--color-surface,#f7f5f1)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:grid-cols-[15.5rem_minmax(0,1fr)] md:px-6 md:py-10">
        <aside className="md:sticky md:top-6 md:self-start">
          <AdminNav />
        </aside>
        <div className="min-w-0">
          {verified ? (
            tokenReady ? (
              children
            ) : (
              <AdminTokenGate />
            )
          ) : (
            <AdminMfaGate
              organizationId={auth.ctx.organization.id}
              state={mfaState}
            />
          )}
        </div>
      </div>
    </div>
  );
}
