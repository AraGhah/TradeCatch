/** No answers, identifiers, query strings or contact information enter this API. */
export function createAuditFunnel(input: {
  locale: "en" | "fr";
  allowed: () => boolean;
  track: (event: string, params: Record<string, string | number>) => void;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  let started = false,
    completed = false,
    left = false,
    step = "name",
    since = 0;
  function emit(event: string, extra: Record<string, string | number> = {}) {
    if (input.allowed())
      input.track(event, {
        locale: input.locale,
        form_version: "short_contact_v2",
        step,
        ...extra,
      });
  }
  return {
    view(next: string) {
      step = next;
      if (started && !completed && !left) emit("audit_step_viewed");
    },
    touch() {
      if (completed || !input.allowed()) return;
      if (!started) {
        started = true;
        since = now();
        emit("audit_form_started");
        emit("audit_step_viewed");
      } else if (left) {
        left = false;
        emit("audit_form_resumed");
      }
    },
    abandon(reason: "hidden" | "pagehide" | "navigation") {
      if (!started || completed || left || !input.allowed()) return;
      left = true;
      emit("audit_form_abandoned", {
        reason,
        elapsed_seconds: Math.max(0, Math.round((now() - since) / 1000)),
      });
    },
    complete() {
      completed = true;
      if (started) emit("audit_form_completed");
    },
  };
}
