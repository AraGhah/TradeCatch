import { z } from "zod";

/** Configurable SMS qualification steps for website leads (mirrors Module A shape). */
export const qualificationQuestionSchema = z.object({
  id: z.string().min(1).max(40),
  enabled: z.boolean(),
  promptFr: z.string().min(1).max(400),
  promptEn: z.string().min(1).max(400),
  required: z.boolean(),
});

export type QualificationQuestion = z.infer<typeof qualificationQuestionSchema>;

export const orgSettingsSchema = z.object({
  notifyEmail: z.string().email().optional().nullable(),
  googleReviewUrl: z.string().url().optional().nullable(),
  crmWebhookUrl: z.string().url().optional().nullable(),
  qualificationQuestions: z.array(qualificationQuestionSchema).max(12).optional(),
  onboardingCompletedAt: z.string().datetime().optional().nullable(),
  localeDefault: z.enum(["en", "fr"]).optional(),
});

export type OrgSettings = {
  organizationId: string;
  notifyEmail?: string;
  googleReviewUrl?: string;
  crmWebhookUrl?: string;
  qualificationQuestions: QualificationQuestion[];
  onboardingCompletedAt?: string;
  localeDefault: "en" | "fr";
  updatedAt: string;
};

export function defaultQualificationQuestions(): QualificationQuestion[] {
  return [
    {
      id: "service",
      enabled: true,
      required: true,
      promptFr: "Quel service vous faut-il ? (ex. fuite, chauffage, panne)",
      promptEn: "What service do you need? (e.g. leak, heating, outage)",
    },
    {
      id: "urgency",
      enabled: true,
      required: true,
      promptFr: "Est-ce urgent (aujourd'hui / 24h) ou planifiable ?",
      promptEn: "Is this urgent (today / 24h) or can it be scheduled?",
    },
    {
      id: "address",
      enabled: true,
      required: false,
      promptFr: "Quelle est l'adresse du chantier ?",
      promptEn: "What is the job site address?",
    },
  ];
}

export function defaultOrgSettings(organizationId: string): OrgSettings {
  return {
    organizationId,
    qualificationQuestions: defaultQualificationQuestions(),
    localeDefault: "en",
    updatedAt: new Date().toISOString(),
  };
}

export function enabledQualification(
  questions: QualificationQuestion[],
): QualificationQuestion[] {
  return questions.filter((q) => q.enabled);
}

export function nextQualificationId(
  questions: QualificationQuestion[],
  answeredIds: string[],
): string | "done" {
  const enabled = enabledQualification(questions);
  for (const q of enabled) {
    if (!answeredIds.includes(q.id)) return q.id;
  }
  return "done";
}

export function promptForQualification(
  q: QualificationQuestion,
  locale: "en" | "fr",
): string {
  return locale === "fr" ? q.promptFr : q.promptEn;
}
