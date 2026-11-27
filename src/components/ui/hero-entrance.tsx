"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The hero's one entrance: the phone settles into place, then plays the
 * workflow itself (see WorkflowPhone). Only a transform moves, never opacity,
 * so nothing is ever hidden or low in contrast, and the page is complete and
 * usable whether or not this runs. It uses the browser's own Web Animations
 * API, so no animation library is downloaded, and it does nothing for
 * visitors who ask for reduced motion.
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
    const phone = scope.current?.querySelector<HTMLElement>(
      "[data-motion='phone']",
    );
    if (!phone || typeof phone.animate !== "function") return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      return;
    }
    const settle = phone.animate(
      [{ transform: "translateY(14px)" }, { transform: "none" }],
      { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => settle.cancel();
  }, []);

  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}
