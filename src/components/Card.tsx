import { ReactNode } from "react";

export function Card({
  title,
  children,
  icon,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-navy/10 bg-white p-6 shadow-sm">
      {icon ? (
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-blue/10 text-blue">
          {icon}
        </span>
      ) : null}
      <h3 className="text-lg font-semibold text-navy">{title}</h3>
      <div className="mt-2 text-sm leading-relaxed text-text/80">{children}</div>
    </div>
  );
}
