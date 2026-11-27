"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useSingleFlight } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { ActionButton } from "@/components/ui/ActionButton";

export function PilotFeedbackForm({ organizationId }: { organizationId: string }) {
  const t = useTranslations("feedback");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [sent, setSent] = useState(false);
  const flight = useSingleFlight();

  async function submitHandler() {
    setMessage("");
    setMessageError(false);
    setSent(false);
    try {
      const response = await timedFetch(
        `/api/businesses/${organizationId}/feedback`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: "ai",
            description,
            priority: "medium",
          }),
        },
      );
      if (response.ok) {
        setSent(true);
        setMessage("Feedback sent.");
        setDescription("");
      } else {
        setMessageError(true);
        setMessage("Could not send feedback.");
      }
    } catch {
      setMessageError(true);
      setMessage("Could not send feedback. Check your connection and try again.");
    }
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void flight.run(submitHandler);
      }}
    >
      <textarea
        className="min-h-28 rounded-md border border-navy/15 px-3 py-2 text-sm"
        value={description}
        disabled={flight.pending}
        onChange={(event) => {
          setDescription(event.target.value);
          setSent(false);
        }}
        placeholder="What happened?"
      />
      <ActionButton
        type="submit"
        pending={flight.pending}
        busyLabel={t("sending")}
        success={sent}
        successLabel="Sent"
        className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white"
      >
        Send
      </ActionButton>
      {message ? (
        <p
          role={messageError ? "alert" : "status"}
          className={`text-sm ${messageError ? "text-red-800" : "text-navy"}`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
