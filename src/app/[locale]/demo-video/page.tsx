import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

/**
 * The interactive multi-story demo is retired for launch: TradeCatch ships one
 * universal demo video (see WatchDemoButton). Old links go to the home page.
 * The experience itself stays in src/components/demo-video so it can return.
 */
export default async function DemoVideoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect(locale === "fr" ? "/fr" : "/");
}
