import { z } from "zod";
import {
  WEBSITE_FOCUS_AREAS,
  WEBSITE_REQUEST_STATUSES,
  WEBSITE_REQUEST_TYPES,
} from "@/product/website-services/model";

const blankOr = <T extends z.ZodType>(schema: T) =>
  schema.optional().or(z.literal(""));

const MAX_URL_LENGTH = 2048;

/**
 * A website address typed by a person: "mysite.ca", "www.mysite.ca/about" and
 * "https://mysite.ca" are all fine. The server never fetches it (the team opens
 * it by hand), so this only has to produce something safe to store and to show:
 * http(s) only, no credentials, no whitespace, and `javascript:` or `data:`
 * links are impossible because only the two web schemes survive.
 */
export function normalizeWebsiteUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > MAX_URL_LENGTH || /\s/.test(text)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  // "javascript:alert(1)", "mailto:a@b.ca", "data:..." are schemes, not hosts.
  // "mysite.ca:8080" is a host and a port, which is fine.
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:(?!\d+(?:[/?#]|$))/i.test(text)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  // The URL parser punycodes international names, so ASCII is enough here.
  const host = url.hostname.toLowerCase();
  if (
    !/^[a-z0-9.-]+$/.test(host) ||
    !host.includes(".") ||
    host.endsWith(".")
  ) {
    return null;
  }
  return url.toString();
}

const phone = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(/^[0-9+()\-.\s]+$/);

/**
 * The short website-service request. Shared by the public form, the onboarding
 * step and the dashboard (field errors on the client) and by the API routes
 * (full re-validation: never trust the client).
 *
 * When the customer wants an existing site improved we need to know which
 * one, so the address is required for `improve` and optional for `new`.
 */
export const websiteRequestSchema = z
  .object({
    requestType: z.enum(WEBSITE_REQUEST_TYPES),
    businessName: z.string().trim().min(1).max(120),
    contactName: z.string().trim().min(1).max(120),
    contactEmail: z.string().trim().min(1).max(254).email(),
    contactPhone: blankOr(phone),
    currentWebsiteUrl: blankOr(z.string().max(MAX_URL_LENGTH)),
    focusAreas: z
      .array(z.enum(WEBSITE_FOCUS_AREAS))
      .max(WEBSITE_FOCUS_AREAS.length),
    notes: blankOr(z.string().trim().max(1000)),
    language: z.enum(["en", "fr"]),
  })
  .superRefine((value, ctx) => {
    const url = value.currentWebsiteUrl?.trim() ?? "";
    if (url) {
      if (normalizeWebsiteUrl(url) === null) {
        ctx.addIssue({
          code: "custom",
          path: ["currentWebsiteUrl"],
          message: "invalid_url",
        });
      }
    } else if (value.requestType === "improve") {
      ctx.addIssue({
        code: "custom",
        path: ["currentWebsiteUrl"],
        message: "url_required",
      });
    }
  });

export type WebsiteRequestInput = z.infer<typeof websiteRequestSchema>;

/** The public form adds the same bot checks as the other public forms. */
export const publicWebsiteRequestSchema = websiteRequestSchema.safeExtend({
  /** Honeypot: real visitors never see or fill this. */
  companyWebsite: z.string().max(500).optional().default(""),
  turnstileToken: z.string().min(1),
  idempotencyKey: z.string().uuid(),
});

/**
 * What an administrator may change on a request. `.strict()` so a stray field
 * (say `organizationId`) is refused instead of silently ignored.
 */
export const websiteRequestUpdateSchema = z
  .object({
    status: z.enum(WEBSITE_REQUEST_STATUSES).optional(),
    quotedPriceCad: z.number().finite().nullable().optional(),
    scopeSummary: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      value.quotedPriceCad !== undefined ||
      value.scopeSummary !== undefined,
    { message: "empty_update" },
  );

export type WebsiteRequestUpdate = z.infer<typeof websiteRequestUpdateSchema>;
