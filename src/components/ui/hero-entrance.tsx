"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The hero's one entrance: the phone settles and the call's steps drop onto
 * the rail in order. The phone's own loop (call-journey-phone.tsx) takes over
 * from there. Only transforms move, never
 * opacity, so nothing is ever hidden or low in contrast, and the page is
 * complete and usable whether or not this runs. GSAP is loaded after the page
 * is interactive, and not at all for visitors who ask for reduced motion.
 */
export function HeroEntrance({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const scope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      return;
    }

    let cancelled = false;
    let revert: (() => void) | undefined;

    void import("gsap")
      .then(({ gsap }) => {
        if (cancelled) return;
        // matchMedia undoes everything if the motion preference changes.
        const media = gsap.matchMedia(root);
        media.add("(prefers-reduced-motion: no-preference)", () => {
          const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
          timeline
            .from("[data-motion='phone']", {
              y: 14,
              duration: 0.7,
              clearProps: "transform",
            })
            .from(
              "[data-motion='stage']",
              { y: -8, duration: 0.45, stagger: 0.14, clearProps: "transform" },
              0.1,
            );
        });
        revert = () => media.revert();
      })
      // Decoration only: a chunk that fails to load must not surface as an error.
      .catch(() => undefined);

    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}
