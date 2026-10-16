import { redirect } from "next/navigation";

/** Analytics maps to the overview dashboard metrics for Task 2 scaffolding. */
export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(locale === "fr" ? "/fr/app" : "/app");
}
