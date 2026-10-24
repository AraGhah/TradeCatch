import Image from "next/image";
import type { getHelpArticle } from "@/product/support/help";

type Article = NonNullable<ReturnType<typeof getHelpArticle>>;

export function HelpArticleBody({
  title,
  body,
  steps,
  expected,
  troubleshooting,
  screenshot,
  locale,
  large = false,
}: Article & { large?: boolean }) {
  const fr = locale === "fr";
  return (
    <article className="flex max-w-2xl flex-col gap-3">
      <h1
        className={`font-[family-name:var(--font-archivo)] font-extrabold text-navy ${large ? "text-3xl" : "text-2xl"}`}
      >
        {title}
      </h1>
      <p className="text-sm leading-6 text-navy/80">{body}</p>
      <section>
        <h2 className="mt-3 text-lg font-semibold text-navy">
          {fr ? "Étapes à suivre" : "Step-by-step instructions"}
        </h2>
        <ol className="mt-3 list-decimal space-y-3 pl-6 text-sm leading-6 text-navy/80">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <figure className="my-3">
        <Image
          src={screenshot.src}
          alt={screenshot.caption}
          width={1000}
          height={640}
          unoptimized
          className="h-auto w-full rounded-md border border-navy/15"
        />
        <figcaption className="mt-2 text-xs leading-5 text-navy/70">
          {fr ? "Exemple fictif — " : "Synthetic example — "}
          {screenshot.caption}
        </figcaption>
      </figure>
      <section className="rounded-md border border-navy/15 bg-white p-4">
        <h2 className="font-semibold text-navy">
          {fr ? "Résultat attendu" : "Expected result"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-navy/80">{expected}</p>
      </section>
      <section>
        <h2 className="mt-3 text-lg font-semibold text-navy">
          {fr ? "Dépannage" : "Troubleshooting"}
        </h2>
        <ul className="mt-3 list-disc space-y-3 pl-6 text-sm leading-6 text-navy/80">
          {troubleshooting.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
