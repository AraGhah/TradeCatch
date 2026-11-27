import { setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { FullMessagesProvider } from "@/components/FullMessagesProvider";
import { SetPasswordFlow } from "@/components/app/SetPasswordFlow";

export const dynamic = "force-dynamic";
// The link is a secret. It rides in the URL fragment, which no server ever
// receives, and this page reads it only in the browser. These headers (see
// next.config.ts) and the tag below keep it out of search results, caches and
// Referer headers; analytics is switched off for this path (src/lib/analytics.ts).
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function SetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <section className="border-b border-navy/10 bg-[var(--color-surface)] py-16 md:py-24">
      <Container>
        <FullMessagesProvider>
          <SetPasswordFlow />
        </FullMessagesProvider>
      </Container>
    </section>
  );
}
