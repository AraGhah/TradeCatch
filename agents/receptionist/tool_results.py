"""Turn TradeCatch's answers into the text the model reads after a tool call
(pure, no LiveKit imports).

Each message states exactly what is true and what the model may now say. The
rule behind all of them: the appointment is "booked" only after the booking
endpoint said `confirmed`, and a failure never leaves the caller in silence.
"""

from __future__ import annotations

from typing import Any, Mapping

from call_record import FoundAppointment, Offer

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
            "The booking system did not respond. The appointment is unconfirmed. "
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


# -- existing appointments and texts -------------------------------------

NO_CHANGE_ADVICE = (
    "Do NOT say anything was found, moved or canceled. Take the caller's name, the "
    "address and what they want changed, call record_details with a message for the "
    "team, and say the team will confirm."
)


def parse_appointments(items: Any) -> list[FoundAppointment]:
    found: list[FoundAppointment] = []
    if not isinstance(items, list):
        return found
    for item in items:
        if not isinstance(item, Mapping):
            continue
        appointment_id, label = item.get("appointmentId"), item.get("label")
        if not appointment_id or not label:
            continue
        found.append(
            FoundAppointment(
                appointment_id=str(appointment_id),
                label=str(label),
                service_name=str(item.get("serviceName") or ""),
                technician=str(item["technicianName"]) if item.get("technicianName") else None,
                status=str(item.get("status") or "confirmed"),
                started=bool(item.get("started")),
            )
        )
    return found


def format_found(result: Mapping[str, Any] | None, found: list[FoundAppointment]) -> str:
    """`result` is the find answer of the appointments endpoint, or None if it failed."""
    if result is None:
        return "The appointment system did not respond. " + NO_CHANGE_ADVICE
    status = result.get("status")
    if status == "found" and found:
        lines = []
        for i, a in enumerate(found, start=1):
            parts = [a.label]
            if a.service_name:
                parts.append(a.service_name)
            if a.technician:
                parts.append(f"technician {a.technician}")
            if a.status == "pending":
                parts.append("requested, not yet confirmed by the team")
            if a.started:
                parts.append("start time already passed")
            lines.append(f"{i}. " + ", ".join(parts))
        return (
            "The caller's own upcoming appointments:\n"
            + "\n".join(lines)
            + "\nYou may tell the caller these times. There is no live tracking of "
            "technicians: never give an arrival estimate. If a start time has passed and "
            "the technician is not there, apologize, call record_details with a message "
            "for the team (the caller is waiting), and offer a transfer if one is "
            "available. To move one, call check_availability with existing_appointment "
            "set to its number, then move_appointment. To cancel one, confirm with the "
            "caller first, then call cancel_appointment."
        )
    if status == "name_needed":
        return (
            "Ask for the name the appointment is under, call record_details with it, "
            "then call find_appointment again."
        )
    if status == "caller_unknown":
        return (
            "The caller's number is hidden, so their appointments cannot be looked up "
            "or changed on this call. " + NO_CHANGE_ADVICE
        )
    if status == "not_found":
        return (
            "No upcoming appointment matches this caller's phone number and name. Do NOT "
            "reveal anything about other bookings. Ask once whether it could be under "
            "another name; if they give one, record it and try again. Otherwise "
            "the appointment may be under a different number. " + NO_CHANGE_ADVICE
        )
    if status == "disabled":
        return "Appointments cannot be looked up on this line. " + NO_CHANGE_ADVICE
    return "The appointment system is unavailable right now. " + NO_CHANGE_ADVICE


def format_move(result: Mapping[str, Any] | None, offers_after: list[Offer], number: int) -> str:
    if result is None:
        return "The appointment system did not respond. It is NOT moved. " + NO_CHANGE_ADVICE
    status = result.get("status")
    if status == "moved":
        return (
            f"MOVED. Appointment {number} is now confirmed for {result.get('label')}. "
            "Tell the caller it is moved and repeat the new date and time once."
        )
    if status == "taken":
        if offers_after:
            return (
                "That time is no longer free, so the appointment is NOT moved. "
                "Offer these instead:\n"
                f"{format_offers(offers_after)}\n"
                f"Then call move_appointment with appointment {number} and the option they pick."
            )
        return "That time is no longer free and nothing else is open. It is NOT moved. " + NO_CHANGE_ADVICE
    if status == "not_found":
        return "That appointment can no longer be changed on this call. It is NOT moved. " + NO_CHANGE_ADVICE
    return "The appointment could not be moved. It is NOT moved. " + NO_CHANGE_ADVICE


def format_cancel(result: Mapping[str, Any] | None) -> str:
    if result is None:
        return "The appointment system did not respond. It is NOT canceled. " + NO_CHANGE_ADVICE
    status = result.get("status")
    if status == "canceled":
        return (
            "CANCELED. Tell the caller the appointment is canceled. Mention a cancellation "
            "policy only if one is in your approved facts. Offer to book another time."
        )
    if status == "not_found":
        return "That appointment can no longer be changed on this call. It is NOT canceled. " + NO_CHANGE_ADVICE
    return "The appointment could not be canceled. It is NOT canceled. " + NO_CHANGE_ADVICE


def format_text(result: Mapping[str, Any] | None) -> str:
    if result is None:
        return "The text could not be sent. Say so honestly and offer to give the details now."
    status = result.get("status")
    if status in ("sent", "already_sent"):
        return (
            "SENT. The text went to the number the caller is calling from. Tell them they "
            "should receive it in a moment. Do not send it again."
        )
    if status == "queued":
        return (
            "The text is queued and should arrive shortly, but it is not sent yet. Say it "
            "should arrive in a few minutes; do not say it was sent."
        )
    if status == "opted_out":
        return (
            "This number has opted out of texts (STOP), so nothing was sent. Say so politely "
            "and give the details by voice instead."
        )
    if status == "not_found":
        return (
            "That appointment cannot be texted on this call. Nothing was sent. Give the "
            "details by voice instead."
        )
    return "Texts are not available on this call. Nothing was sent. Give the details by voice instead."
