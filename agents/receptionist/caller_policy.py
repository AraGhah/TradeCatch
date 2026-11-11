"""What to do with a caller before the receptionist starts, as TradeCatch decided it.

TradeCatch compares the caller ID with the owner's personal-contacts list on the
server and sends back only the decision for this one call (`callerPolicy` in the
agent config). The list itself never reaches the agent or the voice model.

Caller ID can be spoofed, so a policy only ever makes the call *less* capable:
a short message, a hand-off to the owner's own approved line, or a polite end.
Anything unexpected in the payload means "answer normally": a malformed policy
must never hang up on a real customer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal, Mapping

Kind = Literal[
    "personal_message",
    "personal_transfer",
    "personal_end",
    "unknown_message",
    "receptionist_off",
]

_KINDS = {
    "personal_message",
    "personal_transfer",
    "personal_end",
    "unknown_message",
    "receptionist_off",
}
_E164 = re.compile(r"^\+[1-9]\d{7,14}$")
_LANGS = {"fr", "en"}
_MAX_TEXT = 300


@dataclass(frozen=True)
class SpokenLine:
    language: str
    text: str


@dataclass(frozen=True)
class CallerPolicy:
    kind: Kind
    messages: tuple[SpokenLine, ...] = ()
    transfer_e164: str | None = None


# Used only when the business switched its receptionist off and TradeCatch sent no
# usable wording: the line must still never hold a conversation, and must say
# something instead of dropping the call in silence. No names, numbers or promises.
OFF_LINES = (
    SpokenLine("fr", "Nous ne pouvons pas répondre à votre appel pour le moment. Veuillez rappeler plus tard."),
    SpokenLine("en", "We are unable to take your call right now. Please call back later."),
)


def _clean(text: object) -> str | None:
    if not isinstance(text, str):
        return None
    value = " ".join(text.split())
    if not value or len(value) > _MAX_TEXT or any(ch in value for ch in "<>{}"):
        return None
    return value


def _lines(raw: object) -> list[SpokenLine]:
    lines: list[SpokenLine] = []
    if not isinstance(raw, Mapping):
        return lines
    for item in raw.get("messages") or ():
        if not isinstance(item, Mapping):
            continue
        lang, text = item.get("lang"), _clean(item.get("text"))
        if lang in _LANGS and text:
            lines.append(SpokenLine(str(lang), text))
    return lines


def parse_caller_policy(cfg: Mapping[str, Any] | None) -> CallerPolicy | None:
    """The policy for this call, or None when the receptionist should answer."""
    if not cfg:
        return None
    raw = cfg.get("callerPolicy")
    # TradeCatch answers "answering: false" for a line whose owner switched the
    # receptionist off. That is final, even if the rest of the payload is damaged:
    # an unexpected shape must never turn a switched-off line back into a conversation.
    if cfg.get("answering") is False:
        return CallerPolicy(kind="receptionist_off", messages=tuple(_lines(raw)) or OFF_LINES)
    if not isinstance(raw, Mapping):
        return None
    kind = raw.get("kind")
    if kind not in _KINDS:
        return None
    lines = _lines(raw)
    if kind == "receptionist_off":
        return CallerPolicy(kind=kind, messages=tuple(lines) or OFF_LINES)
    transfer = raw.get("transferE164")
    if kind == "personal_transfer":
        if not (isinstance(transfer, str) and _E164.match(transfer)):
            # No usable destination: fall back to the message, never to the AI.
            kind = "personal_message"
            transfer = None
    else:
        transfer = None
    if kind in ("personal_message", "unknown_message") and not lines:
        return None
    return CallerPolicy(kind=kind, messages=tuple(lines), transfer_e164=transfer)


def say_exactly_instruction(policy: CallerPolicy) -> str:
    """Instructions for the voice model: read the owner's lines verbatim, nothing else."""
    script = "\n".join(f"[{line.language}] {line.text}" for line in policy.messages)
    return (
        "Read the following lines aloud exactly as written, each in its own language, "
        "then stop. Do not greet, do not ask anything, do not add any words.\n" + script
    )
