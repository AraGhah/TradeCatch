"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Parallax ink grid + ember glow for the home hero.
 * Translates the grid by scrollY * 0.12; respects reduced motion.
 */
export function HeroBackground() {
  const [offset, setOffset] = useState(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    function onScroll() {
      if (reduced.current || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const next = Math.round(Math.min(window.scrollY, 1200) * 0.12);
        setOffset((prev) => (prev === next ? prev : next));
      });
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div
        aria-hidden
        className="bg-grid-ink pointer-events-none absolute inset-[-10%_0_0_0]"
        style={{ transform: `translateY(${offset}px)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-160px] right-[-120px] h-[520px] w-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(228,118,43,0.16), transparent 66%)",
        }}
      />
    </>
  );
}
