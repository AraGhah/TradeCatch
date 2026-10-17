import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { HelpArticleBody } from "@/components/support/HelpArticleBody";
import { getHelpArticle } from "@/product/support/help";

export default async function AppHelpArticlePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const article = getHelpArticle(id, locale === "fr" ? "fr" : "en");
  if (!article) notFound();
  return <HelpArticleBody title={article.title} body={article.body} />;
}
