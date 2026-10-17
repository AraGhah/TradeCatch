"use client";

import { useState } from "react";

export function PilotFeedbackForm({ organizationId }: { organizationId: string }) {
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");

  async function submit() {
    const response = await fetch(`/api/businesses/${organizationId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "ai", description, priority: "medium" }),
    });
    setMessage(response.ok ? "Feedback sent." : "Could not send feedback.");
  }

  return (
    <form className="flex max-w-xl flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <textarea className="min-h-28 rounded-md border border-navy/15 px-3 py-2 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What happened?" />
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white">Send</button>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </form>
  );
}
