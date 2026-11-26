/**
 * Quiet compliance note for illustrative / simulated content.
 * Plain text only — no sticker, mono stamp, or watermark look.
 */
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
    <p
      className={`m-0 text-[12.5px] leading-snug ${
        light ? "text-white/65" : "text-muted"
      } ${className}`}
    >
      {label}
    </p>
  );
}
