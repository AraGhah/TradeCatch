"""Pure decisions for the receptionist agent (no LiveKit imports, so they can be tested).

The model never supplies a phone number. It names a *reason* (and optionally a
department); the number always comes from the TradeCatch profile, whose transfer
lines are validated server-side. A prompt-injected caller therefore cannot make
the line dial an arbitrary or premium-rate number.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True)
class TransferDecision:
    number: str | None
    # Shown to the model when number is None: why nothing happened.
    refusal: str | None = None


def pick_transfer(
    cfg: Mapping[str, Any],
    reason: str,
    department: str | None = None,
) -> TransferDecision:
    """Choose the number to transfer to, or explain why a transfer is not possible."""
    if reason == "emergency":
        number = cfg.get("emergencyTransferE164") or cfg.get("transferE164")
        if number:
            return TransferDecision(number)
        return TransferDecision(
            None,
            "No emergency line is configured. Tell the caller to hang up and call 911 "
            "if anyone is in danger, and take their details for an urgent callback.",
        )

    # transferHours=always keeps normal transfers ringing after hours when a
    # line exists; business_hours (default) refuses like before.
    if cfg.get("afterHours") and cfg.get("transferHours") != "always":
        return TransferDecision(
            None,
            "The office is closed, so a normal transfer is not possible. "
            "Take the caller's details for a callback when the office opens.",
        )

    wanted = (department or "").strip().lower()
    if wanted:
        for dept in cfg.get("departments") or []:
            if str(dept.get("name", "")).strip().lower() == wanted:
                return TransferDecision(dept["phoneE164"])

    number = cfg.get("transferE164")
    if number:
        return TransferDecision(number)
    return TransferDecision(
        None,
        "No person is available to transfer to. Take the caller's details for a callback.",
    )


@dataclass(frozen=True)
class TransferTarget:
    number: str
    name: str


@dataclass(frozen=True)
class TransferPlan:
    """The numbers to try, in order, and why there are none."""

    targets: tuple[TransferTarget, ...] = ()
    refusal: str | None = None


def _general_line_allowed(cfg: Mapping[str, Any]) -> bool:
    """The owner's rule for ringing the general line outside business hours."""
    return not cfg.get("afterHours") or cfg.get("transferHours") == "always"


def plan_transfer(
    cfg: Mapping[str, Any],
    reason: str,
    department: str | None = None,
) -> TransferPlan:
    """The ordered list of lines to try for a transfer.

    The first line is exactly what `pick_transfer` chooses. A second line is added
    only from numbers the owner already configured: the general line, when it is a
    different number and the owner's hours rule lets it ring. Nothing the caller or
    the model says can add a number.
    """
    decision = pick_transfer(cfg, reason, department)
    if decision.number is None:
        return TransferPlan(refusal=decision.refusal)

    departments = {
        str(d.get("phoneE164")): str(d.get("name") or "")
        for d in cfg.get("departments") or []
        if d.get("phoneE164")
    }
    general = cfg.get("transferE164")
    emergency_line = cfg.get("emergencyTransferE164")

    def label(number: str) -> str:
        if reason == "emergency" and number == (emergency_line or general):
            return "Emergency"
        return departments.get(number) or (
            "General line" if number == general else "Transfer line"
        )

    targets = [TransferTarget(decision.number, label(decision.number))]
    if general and general != decision.number and _general_line_allowed(cfg):
        targets.append(TransferTarget(str(general), label(str(general))))
    return TransferPlan(targets=tuple(targets))


def digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def dialed_number(attributes: Mapping[str, str]) -> str | None:
    """The business number the caller dialed, from LiveKit's SIP participant attributes."""
    return attributes.get("sip.trunkPhoneNumber") or None


def caller_number(attributes: Mapping[str, str]) -> str | None:
    """The caller's number as E.164, or None for withheld/unparseable caller IDs."""
    raw = (attributes.get("sip.phoneNumber") or "").strip()
    value = "+" + digits(raw) if raw.startswith("+") else digits(raw)
    if len(value) == 10:
        value = "+1" + value
    elif len(value) == 11 and value.startswith("1"):
        value = "+" + value
    return value if len(value) >= 11 and value.startswith("+") and len(value) <= 16 else None


def call_id_from_room(room_name: str, fallback: str) -> str:
    """A stable id for TradeCatch, from the room name (LiveKit puts '+' in SIP room names).

    The id must match the server's /^[A-Za-z0-9_.:-]{6,128}$/ and be the same if the
    job is retried, so a repeated report or booking can never be recorded twice.
    """
    cleaned = "".join(ch for ch in room_name if ch.isalnum() or ch in "_.:-")[:128]
    if len(cleaned) >= 6:
        return cleaned
    return "".join(ch for ch in fallback if ch.isalnum() or ch in "_.:-")[:128] or "call-unknown"
