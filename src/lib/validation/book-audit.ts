import { z } from "zod";

// Shared shape used by both the client wizard (per-step slices) and the
// /api/book-audit route (full-payload re-validation). Never trust the client
// slice validation alone — the API route re-parses the complete object.
export const bookAuditSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  company: z.string().trim().min(1).max(120),
  trade: z.string().trim().min(1).max(120),
  email: z.string().trim().min(1).max(254).email(),
  phone: z
    .string()
    .trim()
    .min(7)
    .max(20)
    .regex(/^[0-9+()\-.\s]+$/),
  city: z.string().trim().min(1).max(120),
  preferredLanguage: z.enum(["en", "fr"]),
  employees: z.string().trim().max(40).optional().or(z.literal("")),
  callsPerMonth: z.string().trim().max(40).optional().or(z.literal("")),
  missedCallsPerWeek: z.string().trim().max(40).optional().or(z.literal("")),
  // Choice labels from the redesign wizard (Yes always / Sometimes / No)
  afterHours: z.string().trim().max(40).optional().or(z.literal("")),
  quotesPerMonth: z.string().trim().max(40).optional().or(z.literal("")),
  averageJobValue: z.string().trim().max(40).optional().or(z.literal("")),
  currentCrm: z.string().trim().max(120).optional().or(z.literal("")),
  handlesMissedCalls: z.string().trim().max(200).optional().or(z.literal("")),
  followsUpQuotes: z.string().trim().max(200).optional().or(z.literal("")),
  mainProblem: z.string().trim().max(1000).optional().or(z.literal("")),
  serviceConsent: z.literal(true),
  marketingConsent: z.boolean(),
  /** Exact consent checkbox wording shown to the user (CASL record-keeping). */
  consentWording: z.string().trim().min(1).max(2000),
  consentSource: z.string().trim().min(1).max(120).default("book-audit"),
  companyWebsite: z.string().max(500).optional().default(""),
  turnstileToken: z.string().min(1),
});

export type BookAuditPayload = z.infer<typeof bookAuditSchema>;

/**
 * Short capture wizard for outreach / founding-pilot intake.
 * Deep qualification belongs on the audit call — keep the public form short.
 */
export const BOOK_AUDIT_STEPS = [
  "name",
  "company",
  "trade",
  "email",
  "phone",
  "city",
  "consent",
  "review",
] as const;

export type BookAuditStep = (typeof BOOK_AUDIT_STEPS)[number];

/** Steps the visitor may skip (none in the short capture flow). */
export const OPTIONAL_STEPS: BookAuditStep[] = [];

export const STEP_FIELDS: Record<BookAuditStep, (keyof BookAuditPayload)[]> = {
  name: ["firstName", "lastName"],
  company: ["company"],
  trade: ["trade"],
  email: ["email"],
  phone: ["phone"],
  city: ["city"],
  consent: ["serviceConsent", "marketingConsent"],
  review: [],
};
