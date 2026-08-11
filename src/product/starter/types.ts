import { newId } from "@/product/saas/ids";

export type ConversationMode =
  | "auto"
  | "needs_attention"
  | "human"
  | "resolved";

export type WebsiteLeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "needs_attention"
  | "closed"
  | "spam";

export type WebsiteLead = {
  id: string;
  organizationId: string;
  source: "website";
  name?: string;
  email?: string;
  phoneE164?: string;
  message?: string;
  serviceRequested?: string;
  sourceUrl?: string;
  status: WebsiteLeadStatus;
  conversationMode: ConversationMode;
  idempotencyKey?: string;
  consentAt?: string;
  consentWording?: string;
  openingSmsSent: boolean;
  /** Index into org qualification questions; -1 = done / none. */
  qualificationStepIndex?: number;
  qualificationAnswers?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type QuoteThreadStatus =
  | "active"
  | "paused"
  | "stopped"
  | "won"
  | "lost";

export type QuoteStopReason =
  | "customer_reply"
  | "won"
  | "lost"
  | "opt_out"
  | "manual_pause"
  | "human_takeover"
  | "sequence_complete";

export type QuoteThread = {
  id: string;
  organizationId: string;
  clientAccountId?: string;
  customerPhoneE164: string;
  customerName?: string;
  quoteRef?: string;
  quoteAmount?: number;
  quoteSentAt: string;
  locale: "en" | "fr";
  status: QuoteThreadStatus;
  stopReason?: QuoteStopReason;
  conversationMode: ConversationMode;
  nextStepIndex: number;
  nextRunAt?: string;
  attempts: number;
  lastCustomerReplyAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type QuoteMessage = {
  id: string;
  threadId: string;
  direction: "outbound" | "inbound";
  body: string;
  stepIndex?: number;
  at: string;
};

export type InboxKind = "missed_call" | "website_lead" | "quote";
export type InboxStatus = "open" | "claimed" | "resolved";

export type InboxItem = {
  id: string;
  organizationId: string;
  kind: InboxKind;
  refId: string;
  title: string;
  reason: string;
  status: InboxStatus;
  claimedByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

/** Default quote follow-up delays after quote sent (ms). */
export const DEFAULT_QUOTE_STEPS_MS = [
  1 * 24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
] as const;

export function quoteFollowUpBody(input: {
  locale: "en" | "fr";
  stepIndex: number;
  businessName: string;
  customerName?: string;
  quoteRef?: string;
}): string {
  const name = input.customerName?.trim() || (input.locale === "fr" ? "" : "");
  const hi =
    input.locale === "fr"
      ? name
        ? `Bonjour ${name}`
        : "Bonjour"
      : name
        ? `Hi ${name}`
        : "Hi";
  const ref = input.quoteRef ? ` (${input.quoteRef})` : "";
  const stepsFr = [
    `${hi}, ici ${input.businessName}. Avez-vous eu le temps de regarder notre soumission${ref} ? Des questions ?`,
    `${hi}, je voulais simplement relancer concernant la soumission${ref}. On peut en discuter quand ça vous convient.`,
    `${hi}, toujours intéressé(e) par la soumission${ref} de ${input.businessName} ? Répondez et on s'organise.`,
    `${hi}, dernier suivi pour la soumission${ref}. Dites-nous si on ferme le dossier ou si on avance.`,
  ];
  const stepsEn = [
    `${hi}, this is ${input.businessName}. Did you get a chance to review our estimate${ref}? Any questions?`,
    `${hi}, just following up on the estimate${ref}. Happy to walk through it whenever works.`,
    `${hi}, still interested in the estimate${ref} from ${input.businessName}? Reply and we'll set something up.`,
    `${hi}, last follow-up on estimate${ref}. Tell us if we should close the file or move ahead.`,
  ];
  const steps = input.locale === "fr" ? stepsFr : stepsEn;
  return steps[Math.min(input.stepIndex, steps.length - 1)]!;
}

export function websiteOpeningSms(input: {
  locale: "en" | "fr";
  businessName: string;
  name?: string;
}): string {
  if (input.locale === "fr") {
    const hi = input.name?.trim() ? `Bonjour ${input.name.trim()}` : "Bonjour";
    return `${hi}, ici ${input.businessName}. On a bien reçu votre demande. Que pouvons-nous faire pour vous ?`;
  }
  const hi = input.name?.trim() ? `Hi ${input.name.trim()}` : "Hi";
  return `${hi}, this is ${input.businessName}. We got your request. What can we help you with?`;
}

export function createId(prefix: string) {
  return newId(prefix);
}
