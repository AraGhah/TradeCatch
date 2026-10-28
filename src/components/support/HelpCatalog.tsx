import { Link } from "@/i18n/navigation";
import { searchHelp } from "@/product/support/help";

export function HelpCatalog({ locale, query, base }: { locale: "en" | "fr"; query: string; base: "public" | "app" }) {
  const articles = searchHelp(query, locale);
  return (
    <div className="flex flex-col gap-4">
      <form className="flex max-w-xl gap-2" method="get">
        <input
          name="q"
          defaultValue={query}
          className="w-full rounded-md border border-[rgb(var(--ink-rgb)/0.15)] bg-surface px-3 py-2 text-sm text-text focus-visible:border-orange"
        />
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">{locale === "fr" ? "Chercher" : "Search"}</button>
      </form>
      <ul className="flex flex-col gap-2">
        {articles.map((article) => (
          <li key={article.id}>
            <Link
              href={base === "app" ? { pathname: "/app/help/[id]", params: { id: article.id } } : { pathname: "/help/[id]", params: { id: article.id } }}
              className="block rounded-md border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-3 py-2 transition-colors hover:border-[rgb(var(--ink-rgb)/0.2)] focus-visible:border-orange"
            >
              <span className="text-sm font-semibold text-heading">{article.title}</span>
              <span className="mt-1 block text-sm text-muted">{article.excerpt}</span>
            </Link>
          </li>
        ))}
      </ul>
      {articles.length === 0 ? <p className="text-sm text-muted">{locale === "fr" ? "Aucun article." : "No articles."}</p> : null}
    </div>
  );
}
