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

/** One-question-per-screen wizard steps (presentation), plus review. */
export const BOOK_AUDIT_STEPS = [
  "name",
  "company",
  "trade",
  "city",
  "language",
  "email",
  "phone",
  "employees",
  "calls",
  "missed",
  "afterHours",
  "quotes",
  "jobValue",
  "crm",
  "handlesCalls",
  "followsQuotes",
  "problem",
  "consent",
  "review",
] as const;

export type BookAuditStep = (typeof BOOK_AUDIT_STEPS)[number];

export const OPTIONAL_STEPS: BookAuditStep[] = ["crm", "problem"];

export const STEP_FIELDS: Record<BookAuditStep, (keyof BookAuditPayload)[]> = {
  name: ["firstName", "lastName"],
  company: ["company"],
  trade: ["trade"],
  city: ["city"],
  language: ["preferredLanguage"],
  email: ["email"],
  phone: ["phone"],
  employees: ["employees"],
  calls: ["callsPerMonth"],
  missed: ["missedCallsPerWeek"],
  afterHours: ["afterHours"],
  quotes: ["quotesPerMonth"],
  jobValue: ["averageJobValue"],
  crm: ["currentCrm"],
  handlesCalls: ["handlesMissedCalls"],
  followsQuotes: ["followsUpQuotes"],
  problem: ["mainProblem"],
  consent: ["serviceConsent", "marketingConsent"],
  review: [],
};
