import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

/**
 * True only after the client has taken over. Server snapshot is always
 * false, so SSR/no-JS output matches the pre-hydration client render
 * exactly (no setState-in-effect, no hydration mismatch warning).
 */
export function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
