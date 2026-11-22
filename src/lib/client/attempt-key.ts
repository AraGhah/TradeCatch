"use client";

import { useState } from "react";
import { randomUUID } from "@/lib/id";

/**
 * The idempotency key a form sends with a write, so the server can recognise
 * the same submission arriving twice (a retry after a lost answer, a second
 * tab, a request the browser replayed) and do the work once.
 *
 * The key belongs to what is being sent, not to the click: sending the same
 * content again reuses it until the server has confirmed; changing the content
 * makes it a different submission with a new key, so an edited retry is never
 * answered with the earlier row. After `done()`, the same content sent again
 * is a deliberate new submission.
 *
 * This complements the single-flight lock (`useGuarded` / `useAction`), which
 * stops a second request from starting in this tab at all.
 */
export function createAttemptKey(newKey: () => string = randomUUID) {
  let current: { fingerprint: string; key: string } | null = null;
  return {
    /** The key to send with `fingerprint` (the request body, or what identifies it). */
    for(fingerprint: string): string {
      if (current?.fingerprint !== fingerprint) {
        current = { fingerprint, key: newKey() };
      }
      return current.key;
    },
    /** The server confirmed this submission: the next one is new. */
    done() {
      current = null;
    },
  };
}

/** `createAttemptKey` held for the life of the component. */
export function useAttemptKey() {
  const [keys] = useState(() => createAttemptKey());
  return keys;
}
