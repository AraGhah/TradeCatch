import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getHelpArticle } from "@/product/support/help";

export default async function AppHelpArticlePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const article = getHelpArticle(id, locale === "fr" ? "fr" : "en");
  if (!article) notFound();
  return (
    <article className="flex max-w-2xl flex-col gap-3">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{article.title}</h1>
      <p className="text-sm leading-6 text-navy/80">{article.body}</p>
    </article>
  );
}
