import { z } from "zod";
import { REFERRAL_CODE_PATTERN } from "@/product/referrals/code";

const blankOr = <T extends z.ZodType>(schema: T) =>
  schema.optional().or(z.literal(""));

/**
 * Public "refer a contractor" form. Shared by the client form (field errors)
 * and /api/referrals/submit (full re-validation: never trust the client).
 *
 * The referred person's contact details are third-party data, so the referrer
 * must confirm they have permission to share them (`permissionConfirmed`) and
 * at least one way to reach them is required.
 */
export const referralSubmissionSchema = z
  .object({
    referrerName: z.string().trim().min(1).max(120),
    referrerEmail: z.string().trim().min(1).max(254).email(),
    /** Pattern-checked because it reaches the notification email. */
    referralCode: blankOr(z.string().trim().regex(REFERRAL_CODE_PATTERN)),
    contactName: z.string().trim().min(1).max(120),
    businessName: z.string().trim().min(1).max(120),
    contactEmail: blankOr(z.string().trim().max(254).email()),
    contactPhone: blankOr(
      z
        .string()
        .trim()
        .min(7)
        .max(20)
        .regex(/^[0-9+()\-.\s]+$/),
    ),
    note: blankOr(z.string().trim().max(500)),
    language: z.enum(["en", "fr"]),
    permissionConfirmed: z.literal(true),
    /** Honeypot: real visitors never see or fill this. */
    companyWebsite: z.string().max(500).optional().default(""),
    turnstileToken: z.string().min(1),
  })
  .refine((value) => Boolean(value.contactEmail || value.contactPhone), {
    path: ["contactPhone"],
    message: "contact_required",
  });

export type ReferralSubmission = z.infer<typeof referralSubmissionSchema>;

/** What reaches the team inbox: everything except the bot-check plumbing. */
export type ReferralSubmissionDetails = Omit<
  ReferralSubmission,
  "turnstileToken" | "companyWebsite" | "permissionConfirmed"
>;
