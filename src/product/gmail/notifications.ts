import { createId } from "@/lib/id";
import type { OutboxEvent } from "@/product/notifications/types";
import type { GmailMessage } from "./types";

export function gmailReplyEvent(message: GmailMessage): OutboxEvent {
  const at = new Date().toISOString();
  return {
    id: createId("outbox"),
    organizationId: message.organizationId,
    idempotencyKey: `gmail:${message.accountId}:${message.gmailId}`,
    type: "gmail_reply",
    status: "pending",
    attempts: 0,
    createdAt: at,
    updatedAt: at,
    payload: {
      recipientUserId: message.userId,
      message:
        `${message.fromName || message.fromEmail}${message.subject.trim() ? ` — ${message.subject.trim()}` : ""}`.slice(
          0,
          200,
        ),
      href: `/app/mail/${message.id}`,
    },
  };
}
