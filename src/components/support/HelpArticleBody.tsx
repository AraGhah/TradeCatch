export function HelpArticleBody({ title, body, large = false }: { title: string; body: string; large?: boolean }) {
  return (
    <article className="flex max-w-2xl flex-col gap-3">
      <h1 className={`font-[family-name:var(--font-archivo)] font-extrabold text-navy ${large ? "text-3xl" : "text-2xl"}`}>{title}</h1>
      <p className="text-sm leading-6 text-navy/80">{body}</p>
    </article>
  );
}
