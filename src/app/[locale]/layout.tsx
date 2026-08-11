import type { Metadata } from "next";
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { MotionConfig } from "framer-motion";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CookieConsent } from "@/components/CookieConsent";
import { Analytics } from "@/components/Analytics";
import { HeadInlineScripts } from "@/components/HeadInlineScripts";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { MarketingChrome } from "@/components/MarketingChrome";
import "../globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
  fallback: ["Arial", "Helvetica Neue", "sans-serif"],
  // Offline/CI builds: set NEXT_FONT_GOOGLE_MOCKED_RESPONSES or pre-cache fonts.
  // Prefer self-hosting under public/fonts for fully air-gapped builds.
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  fallback: ["Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  fallback: ["Consolas", "Menlo", "monospace"],
  // Only used for small decorative labels/badges, never headline or body
  // copy — not part of the LCP path, so skip the eager preload hint that
  // was flagging as "preloaded but not used within a few seconds".
  preload: false,
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tradecatch.ca";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const site = await getTranslations({ locale, namespace: "site" });

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: `${site("name")} — ${site("tagline")}`,
      template: `%s — ${site("name")}`,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tradecatch.ca";
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: "TradeCatch",
    url: siteUrl,
    telephone: "+1-438-993-6997",
    areaServed: [
      { "@type": "City", name: "Montréal" },
      { "@type": "City", name: "Laval" },
      { "@type": "City", name: "Mirabel" },
      { "@type": "City", name: "Vaudreuil-Dorion" },
    ],
    availableLanguage: ["en", "fr"],
  };

  return (
    <html
      lang={locale}
      data-scroll-behavior="smooth"
      // The theme-init inline script (HeadInlineScripts) may add "dark" to
      // this element before hydration to avoid a light-then-dark flash —
      // that intentional client/server className mismatch is exactly what
      // suppressHydrationWarning exists for.
      suppressHydrationWarning
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <HeadInlineScripts
          nonce={nonce}
          organizationJsonLd={JSON.stringify(organizationSchema)}
        />
        <MotionConfig reducedMotion="user">
          <NextIntlClientProvider>
            {/* Must sit inside the intl provider — usePathname/useLocale need it. */}
            <Analytics nonce={nonce} />
            <ScrollReveal />
            <MarketingChrome header={<Header />} footer={<Footer />}>
              {children}
            </MarketingChrome>
            <CookieConsent />
          </NextIntlClientProvider>
        </MotionConfig>
      </body>
    </html>
  );
}
