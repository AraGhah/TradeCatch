"use client";

import { useEffect } from "react";
import { CTAButton } from "@/components/CTAButton";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center bg-paper px-[clamp(20px,4vw,40px)] py-20 text-center">
      <p className="text-mono-label text-muted">Something went wrong</p>
      <h1 className="text-page-hero mt-4 max-w-[16em] text-navy">
        We hit a snag loading this page.
      </h1>
      <p className="text-lede mt-5 max-w-[32em] text-muted">
        Try again. If it keeps happening, call{" "}
        <a href="tel:4389936997" className="font-semibold text-ember-text">
          438·993·6997
        </a>
        .
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="rounded-[11px] bg-orange px-[22px] py-[14px] text-[15px] font-semibold text-navy shadow-cta transition-colors hover:bg-orange-dark"
        >
          Try again
        </button>
        <CTAButton href="/" variant="secondary">
          Back to home
        </CTAButton>
      </div>
    </section>
  );
}
