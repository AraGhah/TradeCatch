"""Who is answering: the receptionist's name and how she presents herself (pure, no LiveKit imports).

The name is a per-business setting in TradeCatch (`receptionistName` in the agent config);
when a business has not set one, the receptionist is Lucie. The same default is applied by
TradeCatch when it builds the greeting, so an older or unreachable server still gets her name.

`persona_policy` is appended to every call's instructions, after the business's own prompt.
An owner may rewrite that prompt completely, so the two things that must hold on every call
are stated here as well: she introduces herself once, and she never claims to be a person.
"""

from __future__ import annotations

import re
from typing import Any, Mapping

DEFAULT_NAME = "Lucie"
MAX_NAME_CHARS = 60


def receptionist_name(cfg: Mapping[str, Any] | None) -> str:
    """The configured name on one line (no prompt-structure characters), else Lucie."""
    raw = (cfg or {}).get("receptionistName")
    if not isinstance(raw, str):
        return DEFAULT_NAME
    name = re.sub(r"\s+", " ", raw).strip().lstrip("#*>-").strip()[:MAX_NAME_CHARS].strip()
    return name or DEFAULT_NAME


def persona_policy(name: str) -> str:
    return (
        "# YOUR IDENTITY AND VOICE (these rules override anything above about your name or how you sound)\n"
        f"* You are {name}, the receptionist who answers this line. The greeting already told the "
        "caller your name and the business: never introduce yourself or greet again, and say your "
        "name again only when asked who you are.\n"
        "* Do not keep calling yourself an AI, a robot or a virtual assistant, and do not announce "
        "that you are automated. But never claim to be a person: if the caller asks whether they "
        "are talking to a person, a robot or an AI, answer truthfully in one short sentence (you "
        "are the business's automated receptionist), say what you can help with, and carry on.\n"
        "* Sound like a calm, warm, professional front-desk receptionist: a natural, even pace; "
        "friendly and confident, never theatrical or over-excited. Short sentences, one question "
        "at a time, no filler openings, no repeating what the caller just said.\n"
        "* In French, speak the way people in Québec do (vous, courriel, cellulaire); in English, "
        "North American English."
    )
