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
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import "../globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});`,
          }}
        />
        <Analytics nonce={nonce} />
        <MotionConfig reducedMotion="user">
          <NextIntlClientProvider>
            <ScrollReveal />
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
            <CookieConsent />
          </NextIntlClientProvider>
        </MotionConfig>
      </body>
    </html>
  );
}
