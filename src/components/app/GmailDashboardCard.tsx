import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { gmailConfigured, readGmailEnv } from "@/product/gmail/oauth";
import { getGmailStore } from "@/product/gmail/runtime";

/**
 * Dashboard summary of the person's own mailbox. Reads the local copy only;
 * if the Gmail store is unavailable the card disappears instead of taking the
 * dashboard down with it.
 */
export async function GmailDashboardCard({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}) {
  const t = await getTranslations("app.gmail");
  const store = getGmailStore();
  let data;
  try {
    const [account, recent, unread] = await Promise.all([
      store.getAccount(organizationId, userId),
      store.listMessages(organizationId, userId, { limit: 5 }),
      store.countUnread(organizationId, userId),
    ]);
    data = { account, recent, unread };
  } catch (error) {
    console.warn("[gmail] dashboard card skipped", error instanceof Error ? error.message : "unknown");
    return null;
  }
  const { account, recent, unread } = data;
  const configured = gmailConfigured(readGmailEnv());
  // Nothing to show and nothing to offer: stay out of the way.
  if (!account && !configured) return null;
  const needsReconnect = account?.status === "needs_reconnect";

  return (
    <section
      className="rounded-xl border border-navy/10 bg-white px-4 py-4"
      aria-labelledby="gmail-card-title"
      data-testid="gmail-dashboard-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="gmail-card-title" className="font-[family-name:var(--font-archivo)] text-lg font-extrabold text-navy">
          {t("inboxTitle")}
        </h2>
        {account ? (
          <p className="text-sm font-semibold text-navy" data-testid="gmail-card-unread">
            {t("unreadCount", { count: unread })}
          </p>
        ) : null}
      </div>

      {!account ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-navy/80">{t("dashboardPrompt")}</p>
          <Link href="/app/settings" className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white">
            {t("connect")}
          </Link>
        </div>
      ) : null}

      {needsReconnect ? (
        <p className="mt-2 text-sm text-ember-text" role="alert" data-testid="gmail-card-alert">
          {t("errors.needs_reconnect")}{" "}
          <Link href="/app/settings" className="font-semibold underline">
            {t("reconnect")}
          </Link>
        </p>
      ) : account?.lastError === "sync_failed" || account?.lastError === "rate_limited" ? (
        <p className="mt-2 text-sm text-ember-text">{t(`errors.${account.lastError}`)}</p>
      ) : null}

      {account && recent.length > 0 ? (
        <>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-[0.06em] text-navy/70">{t("recent")}</h3>
          <ul className="mt-1 divide-y divide-navy/10">
            {recent.map((message) => (
              <li key={message.id} className="py-2">
                <Link
                  href={{ pathname: "/app/mail/[id]", params: { id: message.id } }}
                  className={`block text-sm text-navy ${message.unread ? "font-extrabold" : "font-semibold"}`}
                >
                  {message.unread ? (
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-orange align-middle" aria-hidden="true" />
                  ) : null}
                  {message.subject || t("noSubject")}
                  {message.unread ? <span className="sr-only"> ({t("unread")})</span> : null}
                </Link>
                <p className="text-xs text-navy/70">{message.fromName || message.fromEmail}</p>
              </li>
            ))}
          </ul>
        </>
      ) : account && !needsReconnect ? (
        <p className="mt-2 text-sm text-navy/70">{t("noRecent")}</p>
      ) : null}

      {account ? (
        <Link href="/app/mail" className="mt-3 inline-block text-sm font-semibold text-navy underline">
          {t("openInbox")}
        </Link>
      ) : null}
    </section>
  );
}
