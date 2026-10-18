import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GmailMessageActions } from "@/components/app/GmailMessageActions";
import { Link } from "@/i18n/navigation";
import { getGmailStore } from "@/product/gmail/runtime";
import type { GmailMessage } from "@/product/gmail/types";
import { requireTenantContext } from "@/product/saas/tenant";

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default async function MailMessagePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.gmail");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const { organization, user } = auth.ctx;
  const store = getGmailStore();
  // Scoped to this user inside the query: another person's id is a plain 404.
  const message = await store.getMessage(organization.id, user.id, id);
  if (!message) notFound();
  const [thread, account] = await Promise.all([
    store.listThread(organization.id, user.id, message.threadId),
    store.getAccount(organization.id, user.id),
  ]);
  const format = new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "full",
    timeStyle: "short",
  });
  const gmailUrl = account?.email
    ? `https://mail.google.com/mail/u/${encodeURIComponent(account.email)}/#all/${encodeURIComponent(message.threadId)}`
    : null;

  // A plain render helper rather than a component, so nothing is re-created per render.
  const renderBody = (item: GmailMessage) => (
      <>
        <div
          className="whitespace-pre-wrap break-words px-4 py-4 text-sm text-navy"
          data-testid="gmail-body"
        >
          {item.bodyText || t("noBody")}
        </div>
        {item.attachments.length > 0 ? (
          <div className="border-t border-navy/10 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/70">
              {t("attachments")}
            </h3>
            <ul className="mt-2 flex flex-col gap-1">
              {item.attachments.map((file) => (
                <li key={`${file.partId}-${file.attachmentId}`}>
                  <a
                    className="text-sm font-semibold text-navy underline"
                    href={`/api/app/gmail/messages/${encodeURIComponent(item.id)}/attachment?part=${encodeURIComponent(file.attachmentId)}`}
                    download
                  >
                    {t("download")} · {file.filename}
                  </a>
                  <span className="ml-2 text-xs text-navy/70">{sizeLabel(file.size)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </>
  );

  return (
    <article className="flex flex-col gap-6">
      <Link href="/app/mail" className="w-fit text-sm font-semibold text-navy underline">
        {t("back")}
      </Link>
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {message.subject || t("noSubject")}
        </h1>
        <p className="mt-2 text-sm text-navy">
          {message.fromName ? `${message.fromName} · ` : ""}
          {message.fromEmail}
        </p>
        <p className="mt-1 text-sm text-navy/70">{format.format(new Date(message.receivedAt))}</p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GmailMessageActions id={message.id} unread={message.unread} />
        {gmailUrl ? (
          <a
            href={gmailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white"
          >
            {t("openInGmail")}
          </a>
        ) : null}
      </div>
      <p className="-mt-3 text-xs text-navy/70">{t("readNote")}</p>

      {thread.length <= 1 ? (
        <div className="rounded-md border border-navy/10 bg-white">
          {renderBody(message)}
        </div>
      ) : (
        <section aria-label={t("thread")} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/70">
            {t("thread")} · {t("threadCount", { count: thread.length })}
          </h2>
          {thread.map((item) => (
            <details
              key={item.id}
              open={item.id === message.id}
              className="rounded-md border border-navy/10 bg-white"
              data-testid="gmail-thread-message"
            >
              <summary className="cursor-pointer px-4 py-3 text-sm text-navy">
                <span className="font-semibold">
                  {item.direction === "outbound" ? t("you") : item.fromName || item.fromEmail}
                </span>
                <span className="ml-2 text-xs text-navy/70">
                  {format.format(new Date(item.receivedAt))}
                </span>
                {item.id !== message.id ? (
                  <span className="ml-2 text-navy/70">{item.snippet.slice(0, 90)}</span>
                ) : null}
              </summary>
              {renderBody(item)}
            </details>
          ))}
        </section>
      )}
    </article>
  );
}
