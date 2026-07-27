export function SectionHeading({
  eyebrow,
  title,
  intro,
  align = "center",
  as: Heading = "h2",
  light = false,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  align?: "center" | "left";
  as?: "h1" | "h2";
  light?: boolean;
  className?: string;
}) {
  const titleClass = Heading === "h1" ? "text-page-hero" : "text-section";
  const hasMaxWidth = /\bmax-w-/.test(className);
  const widthClass = hasMaxWidth
    ? ""
    : align === "center"
      ? "mx-auto max-w-3xl"
      : "max-w-[min(100%,34rem)]";

  return (
    <div
      className={`${widthClass} ${
        align === "center" ? "text-center" : "text-left"
      } ${className}`}
    >
      {eyebrow ? (
        <p
          className={`mb-3 text-[13px] font-medium tracking-[-0.01em] ${
            light ? "text-[rgba(255,255,255,0.64)]" : "text-ember-text"
          }`}
        >
          {eyebrow}
        </p>
      ) : null}
      <Heading className={`${titleClass} ${light ? "text-white" : "text-navy"}`}>
        {title}
      </Heading>
      {intro ? (
        <p
          className={`text-lede mt-5 ${
            light ? "text-white/70" : "text-muted"
          }`}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}
