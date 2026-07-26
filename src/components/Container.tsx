import { ReactNode } from "react";

type Size = "default" | "how" | "faq" | "wizard" | "cta";

const maxWidths: Record<Size, string> = {
  default: "max-w-(--container-page)",
  how: "max-w-(--container-how)",
  faq: "max-w-(--container-faq)",
  wizard: "max-w-(--container-wizard)",
  cta: "max-w-[960px]",
};

export function Container({
  children,
  className = "",
  size = "default",
}: {
  children: ReactNode;
  className?: string;
  size?: Size;
}) {
  return (
    <div
      className={`mx-auto w-full ${maxWidths[size]} px-[clamp(20px,4vw,40px)] ${className}`}
    >
      {children}
    </div>
  );
}
