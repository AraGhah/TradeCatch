import {
  isDurableMissedCallStoreConfigured,
  isE2eHarness,
  isRealProductionRuntime,
} from "@/lib/config";
import { getPgPool } from "@/product/missed-call/postgres-store";
import {
  createMemorySmsInbox,
  createPostgresSmsInbox,
  drainSmsInbox,
  type SmsInbox,
} from "./inbox";
import { processInboundSms } from "./inbound";

const state = globalThis as typeof globalThis & {
  __tradecatchSmsInbox?: SmsInbox;
};
/**
 * False only in a real production runtime with no durable store selected. The
 * webhook refuses (503) to accept a text in that state, so the inbox is
 * necessarily empty and maintenance has nothing to drain.
 */
export function isSmsInboxAvailable(): boolean {
  return (
    isDurableMissedCallStoreConfigured() ||
    !isRealProductionRuntime() ||
    isE2eHarness()
  );
}
export function getSmsInbox(): SmsInbox {
  if (state.__tradecatchSmsInbox) return state.__tradecatchSmsInbox;
  if (isDurableMissedCallStoreConfigured()) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("SMS inbox requires DATABASE_URL");
    return (state.__tradecatchSmsInbox = createPostgresSmsInbox(
      getPgPool(url),
    ));
  }
  if (isRealProductionRuntime() && !isE2eHarness())
    throw new Error("SMS inbox requires durable storage");
  return (state.__tradecatchSmsInbox = createMemorySmsInbox());
}
export async function processSmsInbox() {
  return drainSmsInbox(getSmsInbox(), processInboundSms);
}
