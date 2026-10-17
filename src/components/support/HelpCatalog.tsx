import { Link } from "@/i18n/navigation";
import { searchHelp } from "@/product/support/help";

export function HelpCatalog({ locale, query, base }: { locale: "en" | "fr"; query: string; base: "public" | "app" }) {
  const articles = searchHelp(query, locale);
  return (
    <div className="flex flex-col gap-4">
      <form className="flex max-w-xl gap-2" method="get">
        <input name="q" defaultValue={query} className="w-full rounded-md border border-navy/15 px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">{locale === "fr" ? "Chercher" : "Search"}</button>
      </form>
      <ul className="flex flex-col gap-2">
        {articles.map((article) => (
          <li key={article.id}>
            <Link
              href={base === "app" ? { pathname: "/app/help/[id]", params: { id: article.id } } : { pathname: "/help/[id]", params: { id: article.id } }}
              className="block rounded-md border border-navy/10 bg-white px-3 py-2"
            >
              <span className="text-sm font-semibold text-navy">{article.title}</span>
              <span className="mt-1 block text-sm text-navy/70">{article.excerpt}</span>
            </Link>
          </li>
        ))}
      </ul>
      {articles.length === 0 ? <p className="text-sm text-navy/70">{locale === "fr" ? "Aucun article." : "No articles."}</p> : null}
    </div>
  );
}
