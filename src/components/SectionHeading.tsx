export function SectionHeading({
  eyebrow,
  title,
  intro,
  align = "center",
  as: Heading = "h2",
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  align?: "center" | "left";
  as?: "h1" | "h2";
}) {
  const alignClass = align === "center" ? "text-center mx-auto" : "text-left";
  return (
    <div className={`max-w-3xl ${alignClass}`}>
      {eyebrow ? (
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-blue">
          {eyebrow}
        </p>
      ) : null}
      <Heading className="text-3xl font-bold leading-tight text-navy sm:text-4xl">
        {title}
      </Heading>
      {intro ? <p className="mt-4 text-lg text-text/80">{intro}</p> : null}
    </div>
  );
}
