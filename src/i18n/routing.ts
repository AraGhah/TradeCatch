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
    "/ai-receptionist": { en: "/ai-receptionist", fr: "/receptionniste-ia" },
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
    "/demo-video": {
      en: "/demo-video",
      fr: "/demo-video",
    },
    "/login": {
      en: "/login",
      fr: "/connexion",
    },
    "/admin": {
      en: "/admin",
      fr: "/admin",
    },
    "/admin/monitoring": {
      en: "/admin/monitoring",
      fr: "/admin/monitoring",
    },
    "/admin/qa": {
      en: "/admin/qa",
      fr: "/admin/qa",
    },
    "/admin/launch": {
      en: "/admin/launch",
      fr: "/admin/launch",
    },
    "/admin/pilots": {
      en: "/admin/pilots",
      fr: "/admin/pilots",
    },
    "/admin/monitoring/api": {
      en: "/admin/monitoring/api",
      fr: "/admin/monitoring/api",
    },
    "/admin/monitoring/errors": {
      en: "/admin/monitoring/errors",
      fr: "/admin/monitoring/errors",
    },
    "/admin/monitoring/jobs": {
      en: "/admin/monitoring/jobs",
      fr: "/admin/monitoring/jobs",
    },
    "/admin/monitoring/ai": {
      en: "/admin/monitoring/ai",
      fr: "/admin/monitoring/ai",
    },
    "/admin/monitoring/database": {
      en: "/admin/monitoring/database",
      fr: "/admin/monitoring/database",
    },
    "/admin/monitoring/deployments": {
      en: "/admin/monitoring/deployments",
      fr: "/admin/monitoring/deployments",
    },
    "/admin/monitoring/costs": {
      en: "/admin/monitoring/costs",
      fr: "/admin/monitoring/costs",
    },
    "/app": {
      en: "/app",
      fr: "/app",
    },
    "/app/conversations": {
      en: "/app/conversations",
      fr: "/app/conversations",
    },
    "/app/analytics": {
      en: "/app/analytics",
      fr: "/app/analytique",
    },
    "/app/test-center": {
      en: "/app/test-center",
      fr: "/app/centre-de-test",
    },
    "/app/leads": {
      en: "/app/leads",
      fr: "/app/leads",
    },
    "/app/leads/[id]": {
      en: "/app/leads/[id]",
      fr: "/app/leads/[id]",
    },
    "/app/website-leads": {
      en: "/app/website-leads",
      fr: "/app/leads-web",
    },
    "/app/quotes": {
      en: "/app/quotes",
      fr: "/app/soumissions",
    },
    "/app/bookings": {
      en: "/app/bookings",
      fr: "/app/rendez-vous",
    },
    "/app/bookings/availability": {
      en: "/app/bookings/availability",
      fr: "/app/rendez-vous/disponibilite",
    },
    "/app/bookings/services": {
      en: "/app/bookings/services",
      fr: "/app/rendez-vous/services",
    },
    "/app/pipeline": {
      en: "/app/pipeline",
      fr: "/app/pipeline",
    },
    "/app/reviews": {
      en: "/app/reviews",
      fr: "/app/avis",
    },
    "/app/calls": {
      en: "/app/calls",
      fr: "/app/appels",
    },
    "/app/calls/settings": {
      en: "/app/calls/settings",
      fr: "/app/appels/parametres",
    },
    "/app/test-center/live-phone": {
      en: "/app/test-center/live-phone",
      fr: "/app/centre-de-test/telephone-live",
    },
    "/app/receptionist": {
      en: "/app/receptionist",
      fr: "/app/receptionniste",
    },
    "/app/receptionist/fallback": {
      en: "/app/receptionist/fallback",
      fr: "/app/receptionniste/repli",
    },
    "/app/receptionist/privacy": {
      en: "/app/receptionist/privacy",
      fr: "/app/receptionniste/confidentialite",
    },
    "/app/email": {
      en: "/app/email",
      fr: "/app/courriels",
    },
    "/app/timeline": {
      en: "/app/timeline",
      fr: "/app/chronologie",
    },
    "/app/onboarding": {
      en: "/app/onboarding",
      fr: "/app/demarrage",
    },
    "/app/inbox": {
      en: "/app/inbox",
      fr: "/app/boite-reception",
    },
    "/app/settings": {
      en: "/app/settings",
      fr: "/app/parametres",
    },
    "/app/settings/calendar": {
      en: "/app/settings/calendar",
      fr: "/app/parametres/calendrier",
    },
    "/app/settings/notifications": {
      en: "/app/settings/notifications",
      fr: "/app/parametres/notifications",
    },
    "/app/settings/security": {
      en: "/app/settings/security",
      fr: "/app/parametres/securite",
    },
    "/app/feedback": {
      en: "/app/feedback",
      fr: "/app/commentaires",
    },
    "/app/automations": {
      en: "/app/automations",
      fr: "/app/automatisations",
    },
    "/app/notifications": {
      en: "/app/notifications",
      fr: "/app/alertes",
    },
    "/app/notifications/escalation": {
      en: "/app/notifications/escalation",
      fr: "/app/alertes/escalade",
    },
    "/app/automations/missed-call": {
      en: "/app/automations/missed-call",
      fr: "/app/automatisations/appel-manque",
    },
    "/app/automations/quotes": {
      en: "/app/automations/quotes",
      fr: "/app/automatisations/soumissions",
    },
    "/app/automations/templates": {
      en: "/app/automations/templates",
      fr: "/app/automatisations/modeles",
    },
    "/app/automations/history": {
      en: "/app/automations/history",
      fr: "/app/automatisations/historique",
    },
  },
});

export type AppPathnames = keyof typeof routing.pathnames;
