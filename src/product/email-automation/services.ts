import type { Clock } from "@/product/missed-call/types";
import { normalizeEmail, type EmailAutomationStore } from "./store";
import {
  escapeHtml,
  renderTemplate,
  textToHtml,
  validateTemplate,
  type TemplateVars,
} from "./template";
import type {
  EmailEnrollment,
  EmailPort,
  EmailSequence,
  EmailTemplate,
  EnrollmentStopReason,
  SequenceStep,
} from "./types";

export const MAX_SEND_ATTEMPTS = 3;
const HOUR_MS = 60 * 60 * 1000;

export type OrgEmailContext = {
  businessName: string;
  fromEmail: string;
  replyTo?: string;
  locale: "fr" | "en";
};

export type EmailAutomationDeps = {
  store: EmailAutomationStore;
  email: EmailPort;
  clock?: Clock;
  /** Per-org sender identity (CASL: identify the sender). */
  orgContext: (organizationId: string) => Promise<OrgEmailContext | null>;
  /** Absolute unsubscribe URL for a contact. */
  unsubscribeUrl: (organizationId: string, email: string) => string;
};

export class EmailAutomationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_template"
      | "unknown_template"
      | "unknown_sequence"
      | "sequence_inactive"
      | "suppressed"
      | "already_enrolled"
      | "invalid_steps",
  ) {
    super(message);
    this.name = "EmailAutomationError";
  }
}

/** Starter templates seeded for a new org (FR + EN quote follow-up). */
export function defaultTemplates(): Omit<
  EmailTemplate,
  "id" | "organizationId" | "createdAt" | "updatedAt"
>[] {
  return [
    {
      name: "Relance soumission — 1",
      locale: "fr",
      subject:
        'Votre soumission {{ quote_ref | default:"" }} — {{ business_name }}',
      body: [
        'Bonjour {{ first_name | default:"" }},',
        "",
        "Merci encore de nous avoir contactés. Je voulais m'assurer que vous aviez bien reçu notre soumission{% if service %} pour {{ service }}{% endif %}.",
        "",
        "Avez-vous des questions? Répondez simplement à ce courriel et on vous revient rapidement.",
        "",
        "{{ business_name }}",
      ].join("\n"),
    },
    {
      name: "Relance soumission — 2",
      locale: "fr",
      subject: "Toujours intéressé? {{ business_name }}",
      body: [
        'Bonjour {{ first_name | default:"" }},',
        "",
        "Petit suivi concernant notre soumission. Si le moment n'est pas idéal, dites-le-nous et on ajustera l'échéancier.",
        "",
        "{{ business_name }}",
      ].join("\n"),
    },
    {
      name: "Quote follow-up — 1",
      locale: "en",
      subject: 'Your quote {{ quote_ref | default:"" }} — {{ business_name }}',
      body: [
        'Hi {{ first_name | default:"there" }},',
        "",
        "Thanks again for reaching out. I wanted to make sure you received our quote{% if service %} for {{ service }}{% endif %}.",
        "",
        "Any questions? Just reply to this email and we'll get right back to you.",
        "",
        "{{ business_name }}",
      ].join("\n"),
    },
    {
      name: "Quote follow-up — 2",
      locale: "en",
      subject: "Still interested? {{ business_name }}",
      body: [
        'Hi {{ first_name | default:"there" }},',
        "",
        "Quick follow-up on our quote. If the timing isn't right, let us know and we'll work around your schedule.",
        "",
        "{{ business_name }}",
      ].join("\n"),
    },
  ];
}

function firstName(name?: string): string {
  return name?.trim().split(/\s+/)[0] ?? "";
}

function footer(ctx: OrgEmailContext, unsubscribeUrl: string) {
  const fr = ctx.locale === "fr";
  const label = fr ? "Se désabonner" : "Unsubscribe";
  const sentBy = fr
    ? `Envoyé par ${ctx.businessName}.`
    : `Sent by ${ctx.businessName}.`;
  return {
    text: `\n\n--\n${sentBy} ${label}: ${unsubscribeUrl}`,
    html: `<p style="margin:24px 0 0;font-size:12px;color:#5C6875;">${escapeHtml(sentBy)} <a href="${escapeHtml(unsubscribeUrl)}" style="color:#5C6875;">${escapeHtml(label)}</a></p>`,
  };
}

export function createEmailAutomationServices(deps: EmailAutomationDeps) {
  const clock = deps.clock ?? { now: () => new Date() };
  const nowIso = () => clock.now().toISOString();

  function assertTemplateSyntax(subject: string, body: string) {
    for (const [label, src] of [
      ["subject", subject],
      ["body", body],
    ] as const) {
      const v = validateTemplate(src);
      if (!v.ok)
        throw new EmailAutomationError(
          `${label}: ${v.error}`,
          "invalid_template",
        );
    }
  }

  function varsFor(
    enrollment: Pick<EmailEnrollment, "email" | "name" | "vars">,
    ctx: OrgEmailContext,
    unsubscribeUrl: string,
  ): TemplateVars {
    return {
      ...enrollment.vars,
      name: enrollment.name ?? "",
      first_name: firstName(enrollment.name),
      email: enrollment.email,
      business_name: ctx.businessName,
      unsubscribe_url: unsubscribeUrl,
    };
  }

  function renderEmail(
    template: Pick<EmailTemplate, "subject" | "body">,
    vars: TemplateVars,
    ctx: OrgEmailContext,
    unsubscribeUrl: string,
  ) {
    const subject = renderTemplate(template.subject, vars)
      .replace(/\s+/g, " ")
      .trim();
    const text = renderTemplate(template.body, vars);
    const htmlBody = textToHtml(
      renderTemplate(template.body, vars, { html: true }),
    );
    // Always identify the sender + offer unsubscribe unless the template does.
    const needsFooter = !template.body.includes("unsubscribe_url");
    const f = footer(ctx, unsubscribeUrl);
    return {
      subject,
      text: needsFooter ? `${text}${f.text}` : text,
      html: `<!DOCTYPE html><html><body style="margin:0;background:#ffffff;font-family:Helvetica,Arial,sans-serif;color:#1A2430;font-size:15px;line-height:1.6;"><div style="max-width:600px;margin:24px auto;padding:0 16px;">${htmlBody}${needsFooter ? f.html : ""}</div></body></html>`,
    };
  }

  async function assertSteps(organizationId: string, steps: SequenceStep[]) {
    if (steps.length === 0 || steps.length > 10) {
      throw new EmailAutomationError(
        "A sequence needs 1–10 steps",
        "invalid_steps",
      );
    }
    for (const step of steps) {
      if (!(step.delayHours >= 0 && step.delayHours <= 24 * 90)) {
        throw new EmailAutomationError(
          "delayHours must be between 0 and 2160",
          "invalid_steps",
        );
      }
      if (!(await deps.store.getTemplate(step.templateId, organizationId))) {
        throw new EmailAutomationError(
          `Unknown template ${step.templateId}`,
          "unknown_template",
        );
      }
    }
  }

  async function stopEnrollment(
    enrollment: EmailEnrollment,
    reason: EnrollmentStopReason,
  ): Promise<EmailEnrollment | null> {
    return deps.store.updateEnrollment(
      enrollment.id,
      enrollment.organizationId,
      {
        status: "stopped",
        stopReason: reason,
        nextSendAt: undefined,
        lockedUntil: undefined,
      },
    );
  }

  const services = {
    async saveTemplate(input: {
      organizationId: string;
      id?: string;
      name: string;
      locale: "fr" | "en";
      subject: string;
      body: string;
    }): Promise<EmailTemplate> {
      assertTemplateSyntax(input.subject, input.body);
      return deps.store.upsertTemplate(input);
    },

    async saveSequence(input: {
      organizationId: string;
      id?: string;
      name: string;
      steps: SequenceStep[];
      stopOnReply?: boolean;
      active?: boolean;
    }): Promise<EmailSequence> {
      await assertSteps(input.organizationId, input.steps);
      return deps.store.upsertSequence({
        organizationId: input.organizationId,
        id: input.id,
        name: input.name,
        steps: input.steps,
        stopOnReply: input.stopOnReply ?? true,
        active: input.active ?? true,
      });
    },

    /** Seed starter templates + two FR/EN sequences on an empty org. */
    async ensureDefaults(organizationId: string): Promise<void> {
      if ((await deps.store.listTemplates(organizationId)).length > 0) return;
      const created: EmailTemplate[] = [];
      for (const t of defaultTemplates()) {
        created.push(await deps.store.upsertTemplate({ ...t, organizationId }));
      }
      const [fr1, fr2, en1, en2] = created;
      await deps.store.upsertSequence({
        organizationId,
        name: "Relance de soumission (FR)",
        steps: [
          { templateId: fr1!.id, delayHours: 48 },
          { templateId: fr2!.id, delayHours: 120 },
        ],
        stopOnReply: true,
        active: true,
      });
      await deps.store.upsertSequence({
        organizationId,
        name: "Quote follow-up (EN)",
        steps: [
          { templateId: en1!.id, delayHours: 48 },
          { templateId: en2!.id, delayHours: 120 },
        ],
        stopOnReply: true,
        active: true,
      });
    },

    async enroll(input: {
      organizationId: string;
      sequenceId: string;
      email: string;
      name?: string;
      vars?: Record<string, string>;
      source?: string;
      sourceRefId?: string;
      startAt?: Date;
    }): Promise<EmailEnrollment> {
      const email = normalizeEmail(input.email);
      const sequence = await deps.store.getSequence(
        input.sequenceId,
        input.organizationId,
      );
      if (!sequence)
        throw new EmailAutomationError("Unknown sequence", "unknown_sequence");
      if (!sequence.active)
        throw new EmailAutomationError(
          "Sequence is paused",
          "sequence_inactive",
        );
      if (await deps.store.isSuppressed(input.organizationId, email)) {
        throw new EmailAutomationError("Contact unsubscribed", "suppressed");
      }
      if (
        await deps.store.findActiveEnrollment(
          input.organizationId,
          sequence.id,
          email,
        )
      ) {
        throw new EmailAutomationError(
          "Contact already in this sequence",
          "already_enrolled",
        );
      }
      const start = input.startAt ?? clock.now();
      return deps.store.createEnrollment({
        organizationId: input.organizationId,
        sequenceId: sequence.id,
        email,
        name: input.name?.trim() || undefined,
        vars: input.vars ?? {},
        status: "active",
        currentStep: 0,
        nextSendAt: new Date(
          start.getTime() + sequence.steps[0]!.delayHours * HOUR_MS,
        ).toISOString(),
        attempts: 0,
        history: [],
        source: input.source,
        sourceRefId: input.sourceRefId,
      });
    },

    async stop(
      organizationId: string,
      enrollmentId: string,
      reason: EnrollmentStopReason = "manual",
    ) {
      const e = await deps.store.getEnrollment(enrollmentId, organizationId);
      if (!e || e.status !== "active") return e;
      return stopEnrollment(e, reason);
    },

    /** Contact replied: stop every sequence configured with stopOnReply. */
    async markReplied(organizationId: string, email: string): Promise<number> {
      let stopped = 0;
      for (const e of await deps.store.listActiveEnrollmentsByEmail(
        organizationId,
        email,
      )) {
        const seq = await deps.store.getSequence(e.sequenceId, organizationId);
        if (seq?.stopOnReply !== false) {
          await stopEnrollment(e, "replied");
          stopped += 1;
        }
      }
      return stopped;
    },

    /** Choose (or clear, with null) the sequence new website leads are enrolled into. */
    async setAutoEnroll(organizationId: string, sequenceId: string | null) {
      if (sequenceId) {
        const seq = await deps.store.getSequence(sequenceId, organizationId);
        if (!seq) {
          throw new EmailAutomationError(
            "Unknown sequence",
            "unknown_sequence",
          );
        }
      }
      return deps.store.setAutoEnrollSequence(organizationId, sequenceId);
    },

    /**
     * Enroll a fresh website lead into the org's auto-enroll sequence. Off by
     * default. CASL: only when the lead gave an email AND express consent
     * captured by the contractor's form (`consentAt`); never for spam. Never
     * throws for an ineligible lead — lead capture must not fail because of email.
     */
    async autoEnrollWebsiteLead(input: {
      organizationId: string;
      lead: {
        id: string;
        name?: string;
        email?: string;
        consentAt?: string;
        serviceRequested?: string;
        message?: string;
        status?: string;
      };
    }): Promise<{
      enrolled: boolean;
      reason?:
        | "not_configured"
        | "no_email"
        | "no_consent"
        | "spam"
        | "suppressed"
        | "already_enrolled"
        | "sequence_missing"
        | "sequence_inactive";
      enrollmentId?: string;
    }> {
      const { lead, organizationId } = input;
      const { autoEnrollSequenceId } =
        await deps.store.getOrgSettings(organizationId);
      if (!autoEnrollSequenceId)
        return { enrolled: false, reason: "not_configured" };
      if (!lead.email?.trim()) return { enrolled: false, reason: "no_email" };
      if (!lead.consentAt) return { enrolled: false, reason: "no_consent" };
      if (lead.status === "spam") return { enrolled: false, reason: "spam" };

      try {
        const enrollment = await services.enroll({
          organizationId,
          sequenceId: autoEnrollSequenceId,
          email: lead.email,
          name: lead.name,
          vars: {
            service: (lead.serviceRequested ?? "").slice(0, 120),
            message: (lead.message ?? "").slice(0, 200),
          },
          source: "website_lead",
          sourceRefId: lead.id,
        });
        return { enrolled: true, enrollmentId: enrollment.id };
      } catch (err) {
        if (err instanceof EmailAutomationError) {
          const map = {
            suppressed: "suppressed",
            already_enrolled: "already_enrolled",
            unknown_sequence: "sequence_missing",
            sequence_inactive: "sequence_inactive",
          } as const;
          const reason = map[err.code as keyof typeof map];
          if (reason) return { enrolled: false, reason };
        }
        throw err;
      }
    },

    async unsubscribe(organizationId: string, email: string): Promise<number> {
      await deps.store.addSuppression({
        organizationId,
        email,
        reason: "unsubscribed",
        at: nowIso(),
      });
      let stopped = 0;
      for (const e of await deps.store.listActiveEnrollmentsByEmail(
        organizationId,
        email,
      )) {
        await stopEnrollment(e, "unsubscribed");
        stopped += 1;
      }
      return stopped;
    },

    async preview(input: {
      organizationId: string;
      subject: string;
      body: string;
      vars?: Record<string, string>;
      name?: string;
      email?: string;
    }) {
      assertTemplateSyntax(input.subject, input.body);
      const ctx = (await deps.orgContext(input.organizationId)) ?? {
        businessName: "TradeCatch",
        fromEmail: "preview@example.com",
        locale: "fr" as const,
      };
      const email = input.email ?? "client@example.com";
      const unsub = deps.unsubscribeUrl(input.organizationId, email);
      const vars = varsFor(
        { email, name: input.name, vars: input.vars ?? {} },
        ctx,
        unsub,
      );
      return {
        ...renderEmail(input, vars, ctx, unsub),
        variables: Array.from(
          new Set([
            ...validateTemplate(input.subject).variables,
            ...validateTemplate(input.body).variables,
          ]),
        ).sort(),
      };
    },

    /** Cron: send every due step (leased so concurrent ticks never double-send). */
    async processDue(limit = 50): Promise<{
      sent: number;
      failed: number;
      completed: number;
      stopped: number;
    }> {
      const now = clock.now();
      const claimed = await deps.store.claimDueEnrollments(
        now.toISOString(),
        new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        limit,
      );
      const result = { sent: 0, failed: 0, completed: 0, stopped: 0 };

      for (const e of claimed) {
        const sequence = await deps.store.getSequence(
          e.sequenceId,
          e.organizationId,
        );
        if (!sequence || !sequence.active) {
          await stopEnrollment(e, "sequence_inactive");
          result.stopped += 1;
          continue;
        }
        if (await deps.store.isSuppressed(e.organizationId, e.email)) {
          await stopEnrollment(e, "unsubscribed");
          result.stopped += 1;
          continue;
        }
        const step = sequence.steps[e.currentStep];
        if (!step) {
          await deps.store.updateEnrollment(e.id, e.organizationId, {
            status: "completed",
            nextSendAt: undefined,
            lockedUntil: undefined,
          });
          result.completed += 1;
          continue;
        }

        try {
          const template = await deps.store.getTemplate(
            step.templateId,
            e.organizationId,
          );
          const ctx = await deps.orgContext(e.organizationId);
          if (!template || !ctx)
            throw new Error(
              !template ? "template_missing" : "org_context_missing",
            );
          const unsub = deps.unsubscribeUrl(e.organizationId, e.email);
          const rendered = renderEmail(
            template,
            varsFor(e, ctx, unsub),
            { ...ctx, locale: template.locale },
            unsub,
          );
          const { id } = await deps.email.send({
            from: ctx.fromEmail,
            to: e.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            replyTo: ctx.replyTo,
            headers: {
              "List-Unsubscribe": `<${unsub}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          });
          const nextStep = e.currentStep + 1;
          const next = sequence.steps[nextStep];
          await deps.store.updateEnrollment(e.id, e.organizationId, {
            currentStep: nextStep,
            attempts: 0,
            lockedUntil: undefined,
            history: [
              ...e.history,
              {
                step: e.currentStep,
                at: now.toISOString(),
                ok: true,
                providerId: id,
              },
            ],
            status: next ? "active" : "completed",
            nextSendAt: next
              ? new Date(
                  now.getTime() + next.delayHours * HOUR_MS,
                ).toISOString()
              : undefined,
          });
          result.sent += 1;
          if (!next) result.completed += 1;
        } catch (err) {
          const attempts = e.attempts + 1;
          const error =
            err instanceof Error ? err.message.slice(0, 300) : "send_failed";
          const giveUp = attempts >= MAX_SEND_ATTEMPTS;
          await deps.store.updateEnrollment(e.id, e.organizationId, {
            attempts,
            lockedUntil: undefined,
            history: [
              ...e.history,
              { step: e.currentStep, at: now.toISOString(), ok: false, error },
            ],
            status: giveUp ? "failed" : "active",
            // Linear backoff: 30 min, 60 min.
            nextSendAt: giveUp
              ? undefined
              : new Date(
                  now.getTime() + attempts * 30 * 60 * 1000,
                ).toISOString(),
          });
          result.failed += 1;
        }
      }
      return result;
    },
  };
  return services;
}

export type EmailAutomationServices = ReturnType<
  typeof createEmailAutomationServices
>;
