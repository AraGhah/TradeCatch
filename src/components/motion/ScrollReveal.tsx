"use client";

import { useEffect } from "react";
import { usePathname } from "@/i18n/navigation";

/**
 * Wires [data-reveal] and [data-count] via IntersectionObserver.
 * Re-runs on route change. Content stays visible by default — we only
 * hide off-screen nodes after measuring intersection (no blank screenshots).
 */
export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );

    if (!("IntersectionObserver" in window)) {
      nodes.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      nodes.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            const index = Number(el.dataset.revealIndex ?? "0");
            el.style.transitionDelay = `${(index % 5) * 60}ms`;
            el.classList.add("is-visible");
            el.classList.remove("reveal-pending");
            revealObserver.unobserve(el);
          } else if (!el.classList.contains("is-visible")) {
            // Only hide once we've confirmed it's off-screen
            el.classList.add("reveal-pending");
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );

    nodes.forEach((el, i) => {
      if (!el.dataset.revealIndex) el.dataset.revealIndex = String(i);
      // First paint: leave visible. Observer callback decides pending vs visible.
      revealObserver.observe(el);
    });

    // Immediate check for anything already in the viewport (hero-adjacent)
    // so we don't wait for a scroll event.
    requestAnimationFrame(() => {
      nodes.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight || 0;
        const inView = rect.top < vh * 0.92 && rect.bottom > vh * 0.08;
        if (inView) {
          el.classList.add("is-visible");
          el.classList.remove("reveal-pending");
          revealObserver.unobserve(el);
        } else if (!el.classList.contains("is-visible")) {
          el.classList.add("reveal-pending");
        }
      });
    });

    const countObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          countObserver.unobserve(el);
          animateCount(el);
        });
      },
      { threshold: 0.4 },
    );

    document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
      countObserver.observe(el);
    });

    return () => {
      revealObserver.disconnect();
      countObserver.disconnect();
    };
  }, [pathname]);

  return null;
}

function animateCount(el: HTMLElement) {
  const original = el.textContent ?? "";
  const match = original.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) return;
  const target = Number(match[0]);
  if (!target || target > 100000) return;

  const prefix = original.slice(0, original.indexOf(match[0]));
  const suffix = original.slice(original.indexOf(match[0]) + match[0].length);
  const duration = 900;
  const start = performance.now();

  function frame(now: number) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - p) ** 3;
    const value = Math.round(target * eased);
    el.textContent = `${prefix}${value}${suffix}`;
    if (p < 1) {
      requestAnimationFrame(frame);
    } else {
      el.textContent = original;
    }
  }

  requestAnimationFrame(frame);
}
