export function IllustrativeBadge({
  label,
  light = false,
  className = "",
}: {
  label: string;
  light?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase ${
        light
          ? "bg-white/10 text-white/70"
          : "bg-[rgba(12,20,30,0.06)] text-muted"
      } ${className}`}
    >
      {label}
    </span>
  );
}
