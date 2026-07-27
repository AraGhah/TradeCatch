export function LogoMark({
  inverted = false,
  className = "",
}: {
  inverted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${
        inverted ? "bg-white" : "bg-navy"
      } ${className}`}
      aria-hidden
    >
      {/* Inline SVG mark — public/brand-mark.svg is the source asset for favicon/OG use */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M14 34 L27 47 L50 20"
          stroke={inverted ? "#0C141E" : "#E4762B"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function BrandLockup({
  inverted = false,
  className = "",
}: {
  inverted?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark inverted={inverted} />
      <span
        className={`font-heading text-[19px] font-extrabold tracking-[-0.035em] ${
          inverted ? "text-white" : "text-navy"
        }`}
      >
        TradeCatch
      </span>
    </span>
  );
}
