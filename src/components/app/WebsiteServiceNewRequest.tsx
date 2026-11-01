"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  WebsiteRequestForm,
  type WebsiteRequestFormProps,
} from "@/components/WebsiteRequestForm";

/**
 * The website-service request inside the signed-in app. After a request is
 * saved the page's server-rendered list is refreshed so the new request and
 * its status appear straight away. Requesting never touches the subscription.
 */
export function WebsiteServiceNewRequest({
  source,
  defaults,
  submittedMessage,
}: {
  source: "dashboard" | "onboarding";
  defaults: WebsiteRequestFormProps["defaults"];
  submittedMessage?: string;
}) {
  const router = useRouter();
  const [announce, setAnnounce] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <WebsiteRequestForm
        mode="member"
        source={source}
        defaults={defaults}
        onSubmitted={() => {
          setAnnounce(submittedMessage ?? "");
          router.refresh();
        }}
      />
      {/* Screen-reader confirmation that the list on the page has changed. */}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
