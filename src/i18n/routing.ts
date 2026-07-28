import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "fr"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  pathnames: {
    "/": "/",
    "/services": { en: "/services", fr: "/services" },
    "/how-it-works": { en: "/how-it-works", fr: "/fonctionnement" },
    "/industries": { en: "/industries", fr: "/industries" },
    "/pricing": { en: "/pricing", fr: "/tarifs" },
    "/about": { en: "/about", fr: "/a-propos" },
    "/book-audit": { en: "/book-audit", fr: "/reserver-audit" },
    "/faq": { en: "/faq", fr: "/faq" },
    "/privacy-policy": { en: "/privacy-policy", fr: "/politique-de-confidentialite" },
    "/terms-of-service": { en: "/terms-of-service", fr: "/conditions-utilisation" },
    "/cookie-policy": { en: "/cookie-policy", fr: "/politique-de-cookies" },
    "/acceptable-use-policy": {
      en: "/acceptable-use-policy",
      fr: "/politique-utilisation-acceptable",
    },
    "/accessibility-statement": {
      en: "/accessibility-statement",
      fr: "/declaration-accessibilite",
    },
    "/cancellation-refund-policy": {
      en: "/cancellation-refund-policy",
      fr: "/politique-annulation-remboursement",
    },
    "/emergency-service-disclaimer": {
      en: "/emergency-service-disclaimer",
      fr: "/avis-services-urgence",
    },
    "/one-pager": {
      en: "/one-pager",
      fr: "/fiche-resume",
    },
  },
});

export type AppPathnames = keyof typeof routing.pathnames;
