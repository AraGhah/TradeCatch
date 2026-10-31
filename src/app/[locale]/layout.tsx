import type { Metadata } from "next";
import { MotionConfig } from "framer-motion";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import {
  PUBLIC_CLIENT_NAMESPACES,
  pickMessages,
} from "@/i18n/client-messages";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CookieConsent } from "@/components/CookieConsent";
import { Analytics } from "@/components/Analytics";
import { HeadInlineScripts } from "@/components/HeadInlineScripts";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { MarketingChrome } from "@/components/MarketingChrome";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { archivo, plexMono, plexSans } from "@/fonts";
import "../globals.css";

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
  const clientMessages = pickMessages(
    await getMessages(),
    PUBLIC_CLIENT_NAMESPACES,
  );

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
          <NextIntlClientProvider messages={clientMessages}>
            {/* Must sit inside the intl provider — usePathname/useLocale need it. */}
            <DemoModeBanner />
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
