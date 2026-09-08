import { test, expect } from "@playwright/test";

/**
 * Canonical EN/FR marketing URLs must not self-redirect.
 * With localePrefix "as-needed", most EN paths should be 200.
 * A single hop to a different path is OK; Location === request path is a loop.
 */
const ROUTES = [
  "/",
  "/book-audit",
  "/pricing",
  "/services",
  "/how-it-works",
  "/industries",
  "/about",
  "/faq",
  "/one-pager",
  "/demo-video",
  "/login",
  "/privacy-policy",
  "/terms-of-service",
  "/cookie-policy",
  "/acceptable-use-policy",
  "/accessibility-statement",
  "/cancellation-refund-policy",
  "/emergency-service-disclaimer",
  "/fr",
  "/fr/reserver-audit",
  "/fr/tarifs",
  "/fr/services",
  "/fr/fonctionnement",
  "/fr/industries",
  "/fr/a-propos",
  "/fr/faq",
  "/fr/fiche-resume",
  "/fr/demo-video",
  "/fr/connexion",
  "/fr/politique-de-confidentialite",
  "/fr/conditions-utilisation",
  "/fr/politique-de-cookies",
  "/fr/politique-utilisation-acceptable",
  "/fr/declaration-accessibilite",
  "/fr/politique-annulation-remboursement",
  "/fr/avis-services-urgence",
];

test.describe("route matrix", () => {
  for (const path of ROUTES) {
    test(`${path} does not redirect-loop`, async ({ request, baseURL }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      const status = response.status();
      if (status === 200) return;

      expect(
        [301, 302, 303, 307, 308].includes(status),
        `${path} unexpected status ${status}`,
      ).toBeTruthy();

      const location = response.headers()["location"] ?? "";
      const absolute = location.startsWith("http")
        ? location
        : new URL(location, baseURL).toString();
      const nextPath = new URL(absolute).pathname;
      expect(
        nextPath,
        `${path} redirected to itself (${location}) — redirect loop`,
      ).not.toBe(path);
    });

    test(`${path} renders successfully (no 500)`, async ({ request }) => {
      const response = await request.get(path);
      expect(
        response.status(),
        `${path} returned ${response.status()}`,
      ).toBeLessThan(500);
      expect(response.status()).toBeLessThan(400);
    });
  }
});
