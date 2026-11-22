type Enqueue = (input: {
  organizationId: string;
  type: "support_update";
  idempotencyKey: string;
  payload: { simulated: true; message: string };
}) => Promise<{ queued: boolean; duplicate: boolean }>;

/**
 * Queues one platform announcement per business. With the form's key, a repeat
 * of the same announcement (a retry after a lost answer, a second click) lands
 * on the outbox rows the first one created, which are unique per business and
 * key, and queues nothing new.
 */
export async function queueAnnouncement(input: {
  organizationIds: string[];
  message: string;
  idempotencyKey?: string;
  enqueue: Enqueue;
}) {
  const stamp = input.idempotencyKey
    ? `key:${input.idempotencyKey}`
    : Date.now().toString(36);
  let queued = 0;
  let alreadyQueued = 0;
  for (const organizationId of input.organizationIds) {
    const result = await input.enqueue({
      organizationId,
      type: "support_update",
      idempotencyKey: `announce:${stamp}:${organizationId}`,
      payload: { simulated: true, message: input.message },
    });
    if (result.queued) queued += 1;
    else if (result.duplicate) alreadyQueued += 1;
  }
  return { queued, alreadyQueued };
}
