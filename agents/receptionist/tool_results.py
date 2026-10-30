"""Turn TradeCatch's answers into the text the model reads after a tool call
(pure, no LiveKit imports).

Each message states exactly what is true and what the model may now say. The
rule behind all of them: the appointment is "booked" only after the booking
endpoint said `confirmed`, and a failure never leaves the caller in silence.
"""

from __future__ import annotations

from typing import Any, Mapping

from call_record import Offer

MISSING_LABELS = {
    "name": "the caller's name",
    "callback number": "a valid 10-digit callback number",
    "service address": "the service address",
}

NO_BOOKING_ADVICE = (
    "Do NOT say anything is booked or confirmed. Say you have noted the request and "
    "that the team will confirm a time. Ask for the caller's preferred day and time "
    "(if not yet known), call record_details, then continue the call normally."
)


def parse_offers(offers: Any) -> list[Offer]:
    parsed: list[Offer] = []
    if not isinstance(offers, list):
        return parsed
    for item in offers:
        if isinstance(item, Mapping) and item.get("startAt") and item.get("label"):
            parsed.append(Offer(str(item["startAt"]), str(item["label"])))
    return parsed


def format_offers(offers: list[Offer]) -> str:
    return "\n".join(f"{i}. {o.label}" for i, o in enumerate(offers, start=1))


def format_availability(result: Mapping[str, Any] | None, offers: list[Offer]) -> str:
    """`result` is the `availability` object from the endpoint, or None if it failed."""
    if result is None:
        return (
            "The calendar did not respond. " + NO_BOOKING_ADVICE
        )
    if not result.get("ok"):
        reason = result.get("reason")
        if reason == "no_openings":
            return (
                "The calendar has no openings that fit. Do NOT invent a time. "
                "Offer to take a preferred day and time so the team can call back to "
                "schedule. " + NO_BOOKING_ADVICE
            )
        if reason == "booking_disabled" or reason == "not_bookable":
            return (
                "Online booking is not available for this business or service. "
                + NO_BOOKING_ADVICE
            )
        return "The calendar is unavailable right now. " + NO_BOOKING_ADVICE

    lead = (
        "These are the real openings that match the caller's wish."
        if result.get("matchesRequest")
        else "Nothing matched the caller's exact wish; these are the next real openings. "
        "Say so honestly."
    )
    return (
        f"{lead}\n{format_offers(offers)}\n"
        "Read out only these times, in this language, slowly, and let the caller choose. "
        "When they choose, call book_appointment with that option number. "
        "Never offer or promise a time that is not in this list."
    )


def format_booking(
    result: Mapping[str, Any] | None, offers_after: list[Offer]
) -> str:
    """`result` is the `booking` object from the endpoint, or None if it failed."""
    if result is None:
        return (
            "The booking system did not respond, so the appointment is NOT booked. "
            + NO_BOOKING_ADVICE
        )
    status = result.get("status")
    if status == "confirmed":
        return (
            f"BOOKED. The appointment is confirmed for {result.get('label')}. "
            "You may now tell the caller it is booked, and repeat the date and time once. "
            "Do not promise a text or email."
        )
    if status == "taken":
        if offers_after:
            return (
                "That time was just taken by someone else, so it is NOT booked. "
                "Apologize briefly and offer these instead:\n"
                f"{format_offers(offers_after)}\n"
                "Then call book_appointment again with the option the caller picks."
            )
        return (
            "That time was just taken and nothing else is open. It is NOT booked. "
            + NO_BOOKING_ADVICE
        )
    if status == "missing_details":
        missing = [
            MISSING_LABELS.get(str(m), str(m)) for m in result.get("missing") or []
        ]
        return (
            "Cannot book yet because these details are missing: "
            + ", ".join(missing)
            + ". Ask the caller for them, one question at a time, call record_details "
            "with each answer, then call book_appointment again."
        )
    return (
        "The appointment could not be booked online and is NOT booked. "
        + NO_BOOKING_ADVICE
    )
