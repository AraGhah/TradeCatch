import { getPathname } from "@/i18n/pathname";
import { routing } from "@/i18n/routing";
import type { AnchorHref } from "@/components/CTAButton";

/** Pages without route params, i.e. anything that is not "/help/[id]". */
type StaticPathname = Exclude<
  keyof typeof routing.pathnames,
  `${string}[${string}`
>;

function isStaticPathname(value: string): value is StaticPathname {
  return value in routing.pathnames && !value.includes("[");
}

/**
 * Turns "/receptionist#try-it" into the visitor's localized path
 * ("/fr/receptionniste#try-it"). Server-only: typed locale pathnames cannot
 * carry a hash, so the hash is split off, the page is localized, and the
 * hash is put back.
 */
export function localizedAnchor(locale: string, href: string): AnchorHref {
  const [pathname = "", ...rest] = href.split("#");
  const hash = rest.join("#");
  if (!hash || !isStaticPathname(pathname)) {
    throw new Error(`localizedAnchor: unsupported href "${href}"`);
  }
  return `${getPathname({ locale, href: pathname })}#${hash}` as AnchorHref;
}
