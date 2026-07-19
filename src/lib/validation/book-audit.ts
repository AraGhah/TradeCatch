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
  afterHours: z.enum(["yes", "no"]).optional(),
  quotesPerMonth: z.string().trim().max(40).optional().or(z.literal("")),
  averageJobValue: z.string().trim().max(40).optional().or(z.literal("")),
  currentCrm: z.string().trim().max(120).optional().or(z.literal("")),
  handlesMissedCalls: z.string().trim().max(200).optional().or(z.literal("")),
  followsUpQuotes: z.string().trim().max(200).optional().or(z.literal("")),
  mainProblem: z.string().trim().max(1000).optional().or(z.literal("")),
  serviceConsent: z.literal(true),
  marketingConsent: z.boolean(),
  // Honeypot: should stay empty for real visitors, but must still accept
  // arbitrary bot-filled values so the route handler (not schema validation)
  // is what decides how to respond to a filled honeypot.
  companyWebsite: z.string().max(500).optional().default(""),
  turnstileToken: z.string().min(1),
});

export type BookAuditPayload = z.infer<typeof bookAuditSchema>;

export const BOOK_AUDIT_STEPS = [
  "name",
  "company",
  "contact",
  "location",
  "volume",
  "afterHours",
  "quotes",
  "tools",
  "followUp",
  "consent",
  "review",
  "calendar",
] as const;

export type BookAuditStep = (typeof BOOK_AUDIT_STEPS)[number];

// Maps each wizard step to the payload keys it collects, so the client can
// validate only the current step's slice without re-deriving this list.
// "review" and "calendar" collect no new fields of their own.
export const STEP_FIELDS: Record<BookAuditStep, (keyof BookAuditPayload)[]> = {
  name: ["firstName", "lastName"],
  company: ["company", "trade"],
  contact: ["email", "phone"],
  location: ["city", "preferredLanguage"],
  volume: ["employees", "callsPerMonth"],
  afterHours: ["missedCallsPerWeek", "afterHours"],
  quotes: ["quotesPerMonth", "averageJobValue"],
  tools: ["currentCrm", "handlesMissedCalls"],
  followUp: ["followsUpQuotes", "mainProblem"],
  consent: ["serviceConsent", "marketingConsent"],
  review: [],
  calendar: [],
};
