import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Container } from "@/components/Container";
import { HelpArticleBody } from "@/components/support/HelpArticleBody";
import { getHelpArticle } from "@/product/support/help";

export default async function PublicHelpArticlePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const article = getHelpArticle(id, locale === "fr" ? "fr" : "en");
  if (!article) notFound();
  return (
    <Container className="py-12">
      <HelpArticleBody {...article} large />
    </Container>
  );
}
