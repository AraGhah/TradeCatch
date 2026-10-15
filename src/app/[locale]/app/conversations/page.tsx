import { redirect } from "next/navigation";

/** Conversations maps to the existing human-takeover inbox for Task 2. */
export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(locale === "fr" ? "/fr/app/boite-reception" : "/app/inbox");
}
