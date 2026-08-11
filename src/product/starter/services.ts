import type { SmsPort } from "@/product/missed-call/types";
import { isOptOut } from "@/product/missed-call/messaging";
import { demoClientAccount } from "@/product/missed-call/fixtures";
import type { GrowthStore } from "@/product/growth/memory-store";
import { sendBusinessNotifyEmail } from "@/lib/business-notifications";
import {
  enabledQualification,
  promptForQualification,
} from "./qualification";
import {
  buildQuoteThread,
  type StarterStore,
} from "./memory-store";
import {
  DEFAULT_QUOTE_STEPS_MS,
  quoteFollowUpBody,
  websiteOpeningSms,
  type QuoteStopReason,
  type QuoteThread,
  type WebsiteLead,
} from "./types";

export type StarterServices = {
  ingestWebsiteLead(input: {
    organizationId: string;
    businessName: string;
    locale?: "en" | "fr";
    name?: string;
    email?: string;
    phoneE164?: string;
    message?: string;
    serviceRequested?: string;
    sourceUrl?: string;
    idempotencyKey?: string;
    consentAt?: string;
    consentWording?: string;
    smsFromE164?: string;
    sendOpeningSms?: boolean;
    siteUrl?: string;
    enableOwnerNotify?: boolean;
  }): Promise<{ lead: WebsiteLead; smsSent: boolean; duplicate?: boolean }>;

  ingestQuote(input: {
    organizationId: string;
    clientAccountId?: string;
    customerPhoneE164: string;
    customerName?: string;
    quoteRef?: string;
    quoteAmount?: number;
    locale?: "en" | "fr";
    quoteSentAt?: string;
  }): Promise<QuoteThread>;

  processDueQuotes(input: {
    businessNameForOrg: (organizationId: string) => Promise<string>;
    smsFromForOrg: (organizationId: string) => Promise<string | null>;
  }): Promise<{ sent: number; stopped: number; failed: number }>;

  handleInboundSms(input: {
    fromE164: string;
    toE164: string;
    body: string;
    organizationId: string;
  }): Promise<{
    handled: boolean;
    replies: string[];
    stoppedQuote?: boolean;
    qualifiedWebsite?: boolean;
  }>;

  stopQuote(input: {
    organizationId: string;
    threadId: string;
    reason: QuoteStopReason;
    status?: "stopped" | "won" | "lost" | "paused";
  }): Promise<QuoteThread | null>;

  setHumanTakeover(input: {
    organizationId: string;
    kind: "website_lead" | "quote";
    refId: string;
    title: string;
    reason: string;
  }): Promise<void>;
};

function normalizePhone(p: string) {
  return p.replace(/[^\d+]/g, "");
}

export function createStarterServices(deps: {
  store: StarterStore;
  sms: SmsPort;
  growth?: GrowthStore;
}): StarterServices {
  const { store, sms, growth } = deps;

  async function timeline(
    organizationId: string,
    kind: string,
    title: string,
    refId?: string,
    detail?: string,
  ) {
    if (!growth) return;
    await growth.addTimelineEvent({
      organizationId,
      kind,
      refId,
      title,
      detail,
      actor: "system",
      at: new Date().toISOString(),
    });
  }

  return {
    async ingestWebsiteLead(input) {
      const before = input.idempotencyKey
        ? (
            await store.listWebsiteLeads(input.organizationId)
          ).find((l) => l.idempotencyKey === input.idempotencyKey)
        : null;

      const lead = await store.createWebsiteLead({
        organizationId: input.organizationId,
        name: input.name,
        email: input.email,
        phoneE164: input.phoneE164,
        message: input.message,
        serviceRequested: input.serviceRequested,
        sourceUrl: input.sourceUrl,
        status: "new",
        conversationMode: "auto",
        idempotencyKey: input.idempotencyKey,
        consentAt: input.consentAt,
        consentWording: input.consentWording,
        openingSmsSent: false,
        qualificationStepIndex: 0,
        qualificationAnswers: {},
      });

      const duplicate = Boolean(before && before.id === lead.id);
      let smsSent = false;

      if (
        !duplicate &&
        input.sendOpeningSms !== false &&
        input.phoneE164 &&
        input.smsFromE164
      ) {
        const locale = input.locale ?? "en";
        const body = websiteOpeningSms({
          locale,
          businessName: input.businessName,
          name: input.name,
        });
        await sms.send({
          toE164: input.phoneE164,
          fromE164: input.smsFromE164,
          body,
        });
        smsSent = true;

        let nextStep = 0;
        if (growth) {
          const settings = await growth.getOrgSettings(input.organizationId);
          const qs = enabledQualification(settings.qualificationQuestions);
          if (qs[0]) {
            await sms.send({
              toE164: input.phoneE164,
              fromE164: input.smsFromE164,
              body: promptForQualification(qs[0], locale),
            });
            nextStep = 0;
          } else {
            nextStep = -1;
          }
        }

        await store.updateWebsiteLead(lead.id, input.organizationId, {
          openingSmsSent: true,
          status: "contacted",
          qualificationStepIndex: nextStep,
        });
      }

      await store.upsertInboxItem({
        organizationId: input.organizationId,
        kind: "website_lead",
        refId: lead.id,
        title: lead.name || lead.phoneE164 || lead.email || "Website lead",
        reason: "New website lead",
        status: "open",
      });

      if (growth && !duplicate) {
        await growth.upsertPipelineCard({
          organizationId: input.organizationId,
          stage: "new",
          title: lead.name || lead.phoneE164 || lead.email || "Website lead",
          source: "website",
          sourceRefId: lead.id,
          customerPhoneE164: lead.phoneE164,
        });
        await timeline(
          input.organizationId,
          "website_lead",
          "Website lead captured",
          lead.id,
          lead.message,
        );

        const settings = await growth.getOrgSettings(input.organizationId);
        if (input.enableOwnerNotify !== false && settings.notifyEmail) {
          await sendBusinessNotifyEmail({
            toEmail: settings.notifyEmail,
            subject: `New website lead — ${input.businessName}`,
            title: "New website lead",
            lines: [
              { label: "Name", value: lead.name },
              { label: "Phone", value: lead.phoneE164 },
              { label: "Email", value: lead.email },
              { label: "Message", value: lead.message },
              { label: "Service", value: lead.serviceRequested },
            ],
            ctaUrl: input.siteUrl
              ? `${input.siteUrl}/app/website-leads`
              : undefined,
            ctaLabel: "View leads",
          });
        }
      }

      return {
        lead: (await store.getWebsiteLead(lead.id, input.organizationId))!,
        smsSent,
        duplicate,
      };
    },

    async ingestQuote(input) {
      const existing = await store.findActiveQuoteByPhone(
        input.organizationId,
        input.customerPhoneE164,
      );
      if (existing) {
        return (
          (await store.updateQuoteThread(existing.id, input.organizationId, {
            customerName: input.customerName ?? existing.customerName,
            quoteRef: input.quoteRef ?? existing.quoteRef,
            quoteAmount: input.quoteAmount ?? existing.quoteAmount,
            nextStepIndex: 0,
            nextRunAt: new Date(
              Date.now() + DEFAULT_QUOTE_STEPS_MS[0]!,
            ).toISOString(),
            status: "active",
            stopReason: undefined,
            conversationMode: "auto",
          })) ?? existing
        );
      }

      const thread = buildQuoteThread(input);
      const created = await store.createQuoteThread(thread);
      if (growth) {
        await growth.upsertPipelineCard({
          organizationId: input.organizationId,
          stage: "quoted",
          title: input.customerName || input.customerPhoneE164,
          source: "quote",
          sourceRefId: created.id,
          customerPhoneE164: input.customerPhoneE164,
          estimatedValue: input.quoteAmount,
        });
        await timeline(
          input.organizationId,
          "quote_started",
          "Quote follow-up started",
          created.id,
          input.quoteRef,
        );
      }
      return created;
    },

    async processDueQuotes(input) {
      const now = new Date().toISOString();
      const due = await store.listDueQuoteThreads(now, 50);
      let sent = 0;
      let stopped = 0;
      let failed = 0;

      for (const thread of due) {
        if (thread.conversationMode !== "auto") continue;
        const from = await input.smsFromForOrg(thread.organizationId);
        if (!from) {
          failed += 1;
          continue;
        }
        const businessName = await input.businessNameForOrg(
          thread.organizationId,
        );
        const body = quoteFollowUpBody({
          locale: thread.locale,
          stepIndex: thread.nextStepIndex,
          businessName,
          customerName: thread.customerName,
          quoteRef: thread.quoteRef,
        });

        try {
          await sms.send({
            toE164: thread.customerPhoneE164,
            fromE164: from,
            body,
          });
          await store.addQuoteMessage({
            threadId: thread.id,
            direction: "outbound",
            body,
            stepIndex: thread.nextStepIndex,
            at: now,
          });
          sent += 1;

          const nextIndex = thread.nextStepIndex + 1;
          if (nextIndex >= DEFAULT_QUOTE_STEPS_MS.length) {
            await store.updateQuoteThread(thread.id, thread.organizationId, {
              status: "stopped",
              stopReason: "sequence_complete",
              nextRunAt: undefined,
              nextStepIndex: nextIndex,
              attempts: thread.attempts + 1,
            });
            stopped += 1;
          } else {
            const delay = DEFAULT_QUOTE_STEPS_MS[nextIndex]!;
            await store.updateQuoteThread(thread.id, thread.organizationId, {
              nextStepIndex: nextIndex,
              nextRunAt: new Date(
                Date.parse(thread.quoteSentAt) + delay,
              ).toISOString(),
              attempts: thread.attempts + 1,
            });
          }
        } catch {
          failed += 1;
        }
      }

      return { sent, stopped, failed };
    },

    async handleInboundSms(input) {
      const defaults = demoClientAccount();
      if (isOptOut(input.body, defaults)) {
        const active = await store.findActiveQuoteByPhone(
          input.organizationId,
          input.fromE164,
        );
        if (active) {
          await store.updateQuoteThread(active.id, input.organizationId, {
            status: "stopped",
            stopReason: "opt_out",
            nextRunAt: undefined,
            lastCustomerReplyAt: new Date().toISOString(),
          });
          await store.addQuoteMessage({
            threadId: active.id,
            direction: "inbound",
            body: input.body,
            at: new Date().toISOString(),
          });
          return { handled: true, replies: [], stoppedQuote: true };
        }
        return { handled: false, replies: [] };
      }

      const active = await store.findActiveQuoteByPhone(
        input.organizationId,
        input.fromE164,
      );
      if (active) {
        await store.addQuoteMessage({
          threadId: active.id,
          direction: "inbound",
          body: input.body,
          at: new Date().toISOString(),
        });
        await store.updateQuoteThread(active.id, input.organizationId, {
          status: "stopped",
          stopReason: "customer_reply",
          conversationMode: "needs_attention",
          nextRunAt: undefined,
          lastCustomerReplyAt: new Date().toISOString(),
        });
        await store.upsertInboxItem({
          organizationId: input.organizationId,
          kind: "quote",
          refId: active.id,
          title: active.customerName || active.customerPhoneE164,
          reason: "Customer replied to quote follow-up",
          status: "open",
        });
        if (growth) {
          await timeline(
            input.organizationId,
            "quote_reply",
            "Customer replied to quote",
            active.id,
            input.body,
          );
          const settings = await growth.getOrgSettings(input.organizationId);
          if (settings.notifyEmail) {
            await sendBusinessNotifyEmail({
              toEmail: settings.notifyEmail,
              subject: "Quote reply — needs attention",
              title: "Customer replied to a quote follow-up",
              lines: [
                { label: "Customer", value: active.customerName },
                { label: "Phone", value: active.customerPhoneE164 },
                { label: "Reply", value: input.body },
              ],
            });
          }
        }
        return { handled: true, replies: [], stoppedQuote: true };
      }

      // Website lead qualification answers
      if (growth) {
        const leads = await store.listWebsiteLeads(input.organizationId);
        const lead = leads.find(
          (l) =>
            l.phoneE164 &&
            normalizePhone(l.phoneE164) === normalizePhone(input.fromE164) &&
            l.conversationMode === "auto" &&
            (l.qualificationStepIndex ?? -1) >= 0,
        );
        if (lead) {
          const settings = await growth.getOrgSettings(input.organizationId);
          const qs = enabledQualification(settings.qualificationQuestions);
          const idx = lead.qualificationStepIndex ?? 0;
          const current = qs[idx];
          if (!current) {
            return { handled: false, replies: [] };
          }
          const answers = {
            ...(lead.qualificationAnswers ?? {}),
            [current.id]: input.body,
          };
          const nextIdx = idx + 1;
          const replies: string[] = [];
          if (nextIdx < qs.length) {
            const locale = settings.localeDefault;
            replies.push(promptForQualification(qs[nextIdx]!, locale));
            await store.updateWebsiteLead(lead.id, input.organizationId, {
              qualificationAnswers: answers,
              qualificationStepIndex: nextIdx,
              status: "qualified",
            });
          } else {
            await store.updateWebsiteLead(lead.id, input.organizationId, {
              qualificationAnswers: answers,
              qualificationStepIndex: -1,
              status: "qualified",
            });
            await growth.upsertPipelineCard({
              organizationId: input.organizationId,
              stage: "qualified",
              title: lead.name || lead.phoneE164 || "Website lead",
              source: "website",
              sourceRefId: lead.id,
              customerPhoneE164: lead.phoneE164,
            });
            await timeline(
              input.organizationId,
              "website_qualified",
              "Website lead qualified",
              lead.id,
            );
          }
          if (replies[0] && input.toE164) {
            await sms.send({
              toE164: input.fromE164,
              fromE164: input.toE164,
              body: replies[0],
            });
          }
          return { handled: true, replies, qualifiedWebsite: true };
        }
      }

      return { handled: false, replies: [] };
    },

    async stopQuote(input) {
      return store.updateQuoteThread(input.threadId, input.organizationId, {
        status: input.status ?? "stopped",
        stopReason: input.reason,
        nextRunAt: undefined,
        conversationMode:
          input.reason === "human_takeover" ? "human" : undefined,
      });
    },

    async setHumanTakeover(input) {
      if (input.kind === "website_lead") {
        await store.updateWebsiteLead(input.refId, input.organizationId, {
          conversationMode: "human",
          status: "needs_attention",
          qualificationStepIndex: -1,
        });
      } else {
        await store.updateQuoteThread(input.refId, input.organizationId, {
          conversationMode: "human",
          status: "paused",
          stopReason: "human_takeover",
          nextRunAt: undefined,
        });
      }
      await store.upsertInboxItem({
        organizationId: input.organizationId,
        kind: input.kind,
        refId: input.refId,
        title: input.title,
        reason: input.reason,
        status: "claimed",
      });
    },
  };
}
