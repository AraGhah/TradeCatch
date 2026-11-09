"""Pure decisions for the receptionist agent (no LiveKit imports, so they can be tested).

The model never supplies a phone number. It names a *reason* (and optionally a
department); the number always comes from the TradeCatch profile, whose transfer
lines are validated server-side. A prompt-injected caller therefore cannot make
the line dial an arbitrary or premium-rate number.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

_E164 = re.compile(r"^\+[1-9]\d{9,14}$")
# North American service codes (211-911) and premium-rate area codes.
_NANP_SERVICE = re.compile(r"^[2-9]11$")
_NANP_PREMIUM = {"900", "976"}
# Emergency numbers around the world, in case one is written with a "+".
_EMERGENCY_SHORT = {"911", "112", "999", "000", "110", "119"}


def destination_problem(
    number: object,
    *,
    business_number: str | None = None,
    caller: str | None = None,
) -> str | None:
    """Why a configured transfer number must not be dialed, as a log-safe code.

    None means it is safe. The numbers come from the TradeCatch profile, which
    validates them too; this is the last check before the phone line rings, so a
    bad saved value, a stale config or a mistake can never ring 911, a premium
    line, the business's own number (a loop back into this agent) or the caller.
    """
    value = str(number or "").strip()
    if not value:
        return "missing"
    if value.lstrip("+") in _EMERGENCY_SHORT:
        return "emergency_service"
    if not _E164.match(value):
        return "invalid_format"
    digits = value[1:]
    if digits.startswith("1") and len(digits) == 11:
        area, exchange = digits[1:4], digits[4:7]
        if _NANP_SERVICE.match(area) or _NANP_SERVICE.match(exchange):
            return "emergency_service" if "911" in (area, exchange) else "service_code"
        if area[0] in "01" or exchange[0] in "01":
            return "invalid_format"
        if area in _NANP_PREMIUM:
            return "premium_rate"
    if business_number and value == business_number.strip():
        return "business_line"
    if caller and value == caller.strip():
        return "caller_number"
    return None


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
    # Codes for configured lines that were skipped as unsafe (for the log; no numbers).
    rejected: tuple[str, ...] = ()


def _general_line_allowed(cfg: Mapping[str, Any]) -> bool:
    """The owner's rule for ringing the general line outside business hours."""
    return not cfg.get("afterHours") or cfg.get("transferHours") == "always"


def plan_transfer(
    cfg: Mapping[str, Any],
    reason: str,
    department: str | None = None,
    *,
    business_number: str | None = None,
    caller: str | None = None,
) -> TransferPlan:
    """The ordered list of lines to try for a transfer.

    The first line is what `pick_transfer` chooses. Further lines come only from
    numbers the owner already configured, each when it is a different number:
    the general line, then the backup line (the owner's secondary transfer
    number), each only when the owner's hours rule lets it ring. An emergency is
    the emergency line first, then (during hours, or with transferHours=always)
    the general and backup lines; after that the agent takes an urgent callback
    and TradeCatch alerts the owner. Nothing the caller or the model says can add
    a number, and every line passes `destination_problem` before it is offered.
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
    backup = cfg.get("backupTransferE164")
    emergency_line = cfg.get("emergencyTransferE164")
    emergency = reason == "emergency"

    def label(number: str) -> str:
        if emergency and number == (emergency_line or general):
            return "Emergency"
        if number in departments:
            return departments[number]
        if number == general:
            return "General line"
        return "Backup line" if number == backup else "Transfer line"

    candidates = [str(decision.number)]
    if _general_line_allowed(cfg):
        for extra in (general, backup):
            if extra and str(extra) not in candidates:
                candidates.append(str(extra))

    targets: list[TransferTarget] = []
    rejected: list[str] = []
    for number in candidates:
        problem = destination_problem(number, business_number=business_number, caller=caller)
        if problem:
            rejected.append(problem)
        else:
            targets.append(TransferTarget(number, label(number)))
    if not targets:
        refusal = (
            "No emergency line can be dialed right now. Tell the caller to hang up and call "
            "911 if anyone is in danger, and take their details for an urgent callback."
            if emergency
            else "No person can be reached by transfer right now. Take the caller's details "
            "for a callback."
        )
        return TransferPlan(refusal=refusal, rejected=tuple(rejected))
    return TransferPlan(targets=tuple(targets), rejected=tuple(rejected))


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
