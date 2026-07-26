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
      <span
        className={`block h-[7px] w-[14px] origin-center -translate-y-px rotate-[-45deg] border-b-[2.2px] border-l-[2.2px] ${
          inverted ? "border-navy" : "border-orange"
        }`}
      />
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
