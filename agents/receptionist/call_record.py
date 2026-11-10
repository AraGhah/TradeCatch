"""What the agent knows about one call (pure, no LiveKit imports).

The model supplies caller details through `record_details`; this module is the
only thing that decides what is kept. Values are trimmed and bounded to what the
TradeCatch report endpoint accepts (one oversize field would get the whole report
rejected), phone numbers are validated, and the booking facts (which times were
really offered, whether one was really booked) come from the server's answers,
never from the model.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Mapping

# tool argument -> (report slot, max characters). Limits match agent-api.ts.
SLOT_FIELDS: Mapping[str, tuple[str, int]] = {
    "caller_name": ("callerName", 80),
    "address": ("serviceAddress", 300),
    "city": ("location", 120),
    "service": ("service", 120),
    "project": ("project", 300),
    "reason": ("issue", 600),
    "preferred_time": ("preferredTime", 200),
    "email": ("email", 120),
    "message": ("message", 600),
}

MAX_TURN_CHARS = 600
MAX_TRANSCRIPT_TURNS = 200

# Slots that make a call a request for work (rather than a question or a wrong number).
REQUEST_SLOTS = ("issue", "service", "project")
# A description shorter than this ("fuite", "plomberie") does not tell a technician anything.
MIN_DESCRIPTION_WORDS = 4

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


def clip(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())[:limit].strip()
    return cleaned or None


def normalize_phone(raw: str | None) -> str | None:
    """A callback number as E.164, or None when it cannot be a real number.

    North American numbers only unless the caller gave an explicit "+" country
    code. Area codes and exchanges never start with 0 or 1, which also catches
    most misheard digits.
    """
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if raw.strip().startswith("+"):
        if digits.startswith("1"):
            return f"+{digits}" if len(digits) == 11 and digits[1] not in "01" and digits[4] not in "01" else None
        return f"+{digits}" if 10 <= len(digits) <= 15 and digits[0] != "0" else None
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01" or digits[3] in "01":
        return None
    return f"+1{digits}"


def is_e164(value: str | None) -> bool:
    return bool(value and re.fullmatch(r"\+[1-9]\d{9,14}", value))


@dataclass(frozen=True)
class Offer:
    start_at: str
    label: str


@dataclass(frozen=True)
class FoundAppointment:
    """One of the caller's own appointments, as the server returned it (no address or phone)."""

    appointment_id: str
    label: str
    service_name: str
    technician: str | None = None
    status: str = "confirmed"
    started: bool = False


@dataclass
class CallRecord:
    call_id: str
    number: str
    from_e164: str | None = None
    language: str = "fr"
    slots: dict[str, str] = field(default_factory=dict)
    transcript: list[dict[str, str]] = field(default_factory=list)
    # Times the scheduling system really offered, in the order they were read out.
    offers: list[Offer] = field(default_factory=list)
    service_id: str | None = None
    service_name: str | None = None
    timezone: str | None = None
    availability_checked: bool = False
    # Set only from a "confirmed" answer of the booking endpoint.
    booking: dict[str, str] | None = None
    # The caller's own appointments, from find_appointment, in the order read out.
    appointments: list[FoundAppointment] = field(default_factory=list)
    # The appointment the current offers are new times for (None: offers are for a new booking).
    offers_for: str | None = None
    # What was really moved or canceled on this call, as the server confirmed it.
    appointment_changes: list[dict[str, str]] = field(default_factory=list)
    transfer: dict[str, Any] | None = None
    emergency: bool = False
    end_reason: str | None = None
    started_at: float = field(default_factory=time.monotonic)

    # -- caller details -------------------------------------------------

    def update(self, **fields: str | None) -> list[str]:
        """Keep the details the model supplied. Returns the names that were rejected."""
        rejected: list[str] = []
        for name, value in fields.items():
            if value is None:
                continue
            if name == "callback_number":
                phone = normalize_phone(value)
                if phone:
                    self.slots["callbackE164"] = phone
                elif value.strip():
                    rejected.append(name)
                continue
            target = SLOT_FIELDS.get(name)
            if not target:
                continue
            slot, limit = target
            cleaned = clip(value, limit)
            if not cleaned:
                continue
            if slot == "email" and not _EMAIL.match(cleaned):
                rejected.append(name)
                continue
            self.slots[slot] = cleaned
        return rejected

    def use_caller_number(self) -> bool:
        """The caller said to use the number they are calling from."""
        if is_e164(self.from_e164):
            self.slots["callbackE164"] = str(self.from_e164)
            return True
        return False

    # -- booking facts --------------------------------------------------

    def set_offers(
        self,
        offers: list[Offer],
        service_id: str | None,
        service_name: str | None,
        timezone: str | None,
    ) -> None:
        self.offers = list(offers)
        self.service_id = service_id or self.service_id
        self.service_name = service_name or self.service_name
        self.timezone = timezone or self.timezone

    def found(self, number: int) -> FoundAppointment | None:
        """Appointment numbers start at 1, as read to the model."""
        if 1 <= number <= len(self.appointments):
            return self.appointments[number - 1]
        return None

    def offer(self, option: int) -> Offer | None:
        """Option numbers start at 1, as read to the model."""
        if 1 <= option <= len(self.offers):
            return self.offers[option - 1]
        return None

    @property
    def booked(self) -> bool:
        return self.booking is not None

    # -- transcript and report -----------------------------------------

    def add_turn(self, speaker: str, text: str | None) -> None:
        cleaned = clip(text, MAX_TURN_CHARS)
        if not cleaned or speaker not in ("agent", "caller"):
            return
        self.transcript.append({"speaker": speaker, "text": cleaned})
        if len(self.transcript) > MAX_TRANSCRIPT_TURNS:
            del self.transcript[: len(self.transcript) - MAX_TRANSCRIPT_TURNS]

    def duration_seconds(self) -> int:
        return max(0, int(time.monotonic() - self.started_at))

    def still_needed(self) -> list[str]:
        """What the owner still lacks to act on this request, in the order to ask it.

        Empty for anything that is not a request for work (a question, a wrong number,
        a completed transfer). Written for the model: each item says what a good answer
        looks like, so a bare city or a one-word problem is asked about again.
        """
        if self.transfer and self.transfer.get("completed"):
            return []
        if not any(k in self.slots for k in REQUEST_SLOTS):
            return []
        needed: list[str] = []
        described = max(
            (len(self.slots.get(k, "").split()) for k in ("issue", "project")), default=0
        )
        if described < MIN_DESCRIPTION_WORDS:
            needed.append(
                "a clear description of the problem or the work (what is wrong or wanted, "
                "where in the home, since when), then save it as reason in a full sentence"
            )
        if not self.emergency and "callerName" not in self.slots:
            needed.append("the caller's name")
        if "callbackE164" not in self.slots:
            needed.append("a callback number (confirm the number they are calling from)")
        if "serviceAddress" not in self.slots:
            needed.append(
                "the street address of the work: number, street and city "
                "(a city or neighbourhood alone is not enough)"
            )
        if not self.emergency and not self.booked and "preferredTime" not in self.slots:
            needed.append("the day and time of day they would like the visit")
        return needed

    def _intent(self) -> str | None:
        if self.transfer and self.transfer.get("completed"):
            return "transfer"
        # A preferred time is a request for an appointment, even when nothing could be
        # booked on the call: the owner must see "appointment to confirm", not "message".
        if (
            self.booked
            or self.availability_checked
            or self.appointment_changes
            or "preferredTime" in self.slots
        ):
            return "appointment"
        if any(k in self.slots for k in REQUEST_SLOTS):
            return "service_request"
        if "message" in self.slots:
            return "message"
        return None

    def report_slots(self) -> dict[str, str]:
        slots = dict(self.slots)
        if "issue" not in slots:
            summary = " — ".join(
                v for v in (slots.get("service"), slots.get("project")) if v
            )
            if summary:
                slots["issue"] = summary[:600]
        return slots

    def payload(self) -> dict[str, Any]:
        """The body of the call report. Always valid for the TradeCatch endpoint."""
        body: dict[str, Any] = {
            "number": self.number,
            "callId": self.call_id,
            "language": self.language if self.language in ("fr", "en") else "fr",
            "slots": self.report_slots(),
            "transcript": list(self.transcript),
            "durationSeconds": self.duration_seconds(),
            "emergency": self.emergency,
        }
        if is_e164(self.from_e164):
            body["from"] = self.from_e164
        intent = self._intent()
        if intent:
            body["intent"] = intent
        if self.transfer:
            body["transfer"] = {
                "targetName": str(self.transfer.get("targetName") or "")[:80],
                "completed": bool(self.transfer.get("completed")),
            }
            # Older servers drop unknown keys, so these are safe to send to any backend.
            if "answerConfirmed" in self.transfer:
                body["transfer"]["answerConfirmed"] = bool(
                    self.transfer.get("completed") and self.transfer.get("answerConfirmed")
                )
            mechanism = self.transfer.get("mechanism")
            if mechanism in ("warm", "blind", "bridge"):
                body["transfer"]["mechanism"] = mechanism
        if self.end_reason:
            body["endReason"] = self.end_reason
        return body
