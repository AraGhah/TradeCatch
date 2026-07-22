import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import { MotionConfig } from "framer-motion";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CookieConsent } from "@/components/CookieConsent";
import { Analytics } from "@/components/Analytics";
import "../globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tradecatch.ca";
  // ProfessionalService rather than a storefront LocalBusiness type: this is
  // a service delivered to contractors wherever they operate, not a
  // location customers visit, so no street address is asserted.
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
    <html lang={locale} className={`${manrope.variable} ${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col pb-16 lg:pb-0">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <Analytics />
        {/* reducedMotion="user" makes every motion component respect the
            visitor's OS-level prefers-reduced-motion setting automatically,
            without any component branching on it — the SSR-safe approach
            (see BookAuditForm.tsx for why per-component branching is unsafe). */}
        <MotionConfig reducedMotion="user">
          <NextIntlClientProvider>
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
