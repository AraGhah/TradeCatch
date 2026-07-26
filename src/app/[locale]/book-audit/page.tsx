import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { BookAuditForm } from "@/components/BookAuditForm";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "bookAudit" });
  return buildMetadata({
    locale,
    pathname: "/book-audit",
    title: t("headline"),
    description: t("intro"),
  });
}

export default async function BookAuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("bookAudit");
  const reassurance = t.raw("reassurance") as string[];

  return (
    <div className="flex min-h-[calc(100vh-var(--header-h))] flex-col bg-paper">
      <BookAuditForm />

      <div className="border-t border-[rgba(12,20,30,0.1)] bg-white/50">
        <div className="mx-auto flex w-full max-w-(--container-wizard) flex-wrap gap-2.5 gap-x-[26px] px-[clamp(20px,4vw,40px)] py-5">
          {reassurance.map((item) => (
            <span
              key={item}
              className="flex items-center gap-2.5 text-[13.5px] text-muted"
            >
              <span
                aria-hidden
                className="block h-[5px] w-[5px] shrink-0 rounded-full bg-signal-text"
              />
              <ReassuranceText text={item} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Linkify a phone number when the reassurance string includes one. */
function ReassuranceText({ text }: { text: string }) {
  const match = text.match(/(\d{3}[·.]\d{3}[·.]\d{4})/);
  if (!match || match.index === undefined) return <>{text}</>;

  const phone = match[1];
  const tel = phone.replace(/[·.]/g, "");
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + phone.length);

  return (
    <>
      {before}
      <a href={`tel:${tel}`} className="font-semibold text-muted hover:text-navy">
        {phone}
      </a>
      {after}
    </>
  );
}
