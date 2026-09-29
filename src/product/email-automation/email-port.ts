import { Resend } from "resend";
import type { EmailPort, OutboundEmail } from "./types";

/** In-memory port for tests. */
export function createMemoryEmailPort(): EmailPort & { sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return { id: `em_mem_${sent.length}` };
    },
  };
}

/**
 * Resend-backed port. Production without RESEND_API_KEY throws on send (never
 * a fake success); development falls back to a logged dry-run.
 */
export function createResendEmailPort(
  env: NodeJS.ProcessEnv = process.env,
): EmailPort {
  const apiKey = env.RESEND_API_KEY?.trim();
  const isProd = env.NODE_ENV === "production";

  if (!apiKey) {
    return {
      async send(message) {
        if (isProd) {
          throw new Error(
            "Resend is not configured (RESEND_API_KEY) — email not sent.",
          );
        }
        console.info("[email-automation] dry-run", {
          to: message.to,
          subject: message.subject.slice(0, 80),
        });
        return { id: `em_dry_${Date.now()}` };
      },
    };
  }

  const client = new Resend(apiKey);
  return {
    async send(message) {
      const result = await client.emails.send({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
        headers: message.headers,
      });
      if (result.error) {
        throw new Error(`Resend rejected email: ${result.error.message}`);
      }
      return { id: result.data?.id ?? "resend_unknown" };
    },
  };
}
