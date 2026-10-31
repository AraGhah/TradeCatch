"""What the agent is told to say at fixed moments (pure, no LiveKit imports).

The words come from TradeCatch (`languageSelect` and `silence` in the agent
config), which builds them from the same prompts as the Twilio engine. The
fallbacks below only apply when an older server does not send those blocks.

A realtime model speaks in its own voice, so these are *instructions to say
exact text*, with the language each line must be spoken in.
"""

from __future__ import annotations

from typing import Any, Mapping

LANGUAGE_NAMES = {"fr": "Canadian French (Québec)", "en": "North American English"}

_FALLBACK_OPENING = "Bonjour! Merci d'avoir appelé."
_FALLBACK_MENU = (
    {"lang": "fr", "text": "Pour continuer en français, restez en ligne."},
    {"lang": "en", "text": "For English, press 1."},
)
_FALLBACK_QUESTION = {
    "fr": "Comment puis-je vous aider aujourd'hui?",
    "en": "How can I help you today?",
}
_FALLBACK_CHECK_IN = {"fr": "Êtes-vous toujours là?", "en": "Are you still there?"}
_FALLBACK_GOODBYE = {
    "fr": "Je n'entends plus rien, alors je vais vous laisser. N'hésitez pas à rappeler. Au revoir!",
    "en": "I'm not hearing anything, so I'll let you go. Feel free to call back. Goodbye!",
}


def _select(cfg: Mapping[str, Any] | None) -> Mapping[str, Any]:
    return (cfg or {}).get("languageSelect") or {}


def start_language(cfg: Mapping[str, Any] | None) -> str:
    return _select(cfg).get("startLanguage") or "fr"


def enabled_languages(cfg: Mapping[str, Any] | None) -> list[str]:
    return list(_select(cfg).get("languages") or ["fr", "en"])


def menu_timeout_seconds(cfg: Mapping[str, Any] | None) -> float:
    value = _select(cfg).get("timeoutSeconds")
    return float(value) if isinstance(value, (int, float)) and value > 0 else 3.0


def menu_keys(cfg: Mapping[str, Any] | None) -> Mapping[str, str] | None:
    keys = _select(cfg).get("keys")
    return keys if isinstance(keys, dict) and keys else None


def _say_exactly(lines: list[tuple[str, str]]) -> str:
    """Instruction that makes the model read lines verbatim, each in its own language."""
    spoken = " ".join(
        f'[{LANGUAGE_NAMES.get(lang, lang)}] "{text}"' for lang, text in lines if text
    )
    return (
        "Say exactly the following, in this order, each part in the language shown, "
        "with a short natural pause between sentences. Add nothing else, then stop and "
        f"wait for the caller: {spoken}"
    )


def say_instruction(language: str, text: str) -> str:
    """Make the model say one fixed line (a check-in, a goodbye) in the given language."""
    return _say_exactly([(language, text)])


def opening_instruction(cfg: Mapping[str, Any] | None) -> str:
    """The greeting plus the language menu, spoken French-first."""
    select = _select(cfg)
    opening = select.get("opening") or {}
    statement = opening.get("statement") or {}
    menu = opening.get("menu")
    if menu is None:
        menu = list(_FALLBACK_MENU)
    lines = [(statement.get("lang") or "fr", statement.get("text") or _FALLBACK_OPENING)]
    lines += [(m.get("lang") or "fr", m.get("text") or "") for m in menu]
    if not menu:
        # A one-language line goes straight from the welcome to the question.
        lines.append((start_language(cfg), after_choice(cfg, start_language(cfg), chosen=False)))
    return _say_exactly(lines)


def after_choice(cfg: Mapping[str, Any] | None, language: str, chosen: bool) -> str:
    """Acknowledgement (only after a key press), after-hours notice, then the first question."""
    block = (_select(cfg).get("afterChoice") or {}).get(language) or {}
    parts = []
    if chosen and block.get("chosen"):
        parts.append(block["chosen"])
    if block.get("afterHoursNotice"):
        parts.append(block["afterHoursNotice"])
    parts.append(block.get("question") or _FALLBACK_QUESTION.get(language, _FALLBACK_QUESTION["fr"]))
    return " ".join(parts)


def after_choice_instruction(
    cfg: Mapping[str, Any] | None, language: str, chosen: bool
) -> str:
    return _say_exactly([(language, after_choice(cfg, language, chosen))])


def language_directive(language: str) -> str:
    """Appended to the business instructions; replaced when the language changes."""
    name = LANGUAGE_NAMES.get(language, language)
    return (
        "# LANGUAGE OF THIS CALL\n"
        f"The call is in {name}. Speak only {name} and keep it for the whole call. "
        "Do not switch because of an accent, a borrowed word or a name. Switch only when "
        "the caller clearly asks for the other language, by calling set_language. "
        "If the caller keeps speaking the other language without asking, answer in the "
        "call's language and offer once, in one short sentence in their language, to "
        "continue in it; switch only if they accept. "
        "Never repeat the greeting or the language menu."
    )


def silence_texts(cfg: Mapping[str, Any] | None, language: str) -> tuple[str, str]:
    """(check-in, goodbye) in the call's language."""
    silence = (cfg or {}).get("silence") or {}
    check_in = (silence.get("checkIn") or {}).get(language) or _FALLBACK_CHECK_IN.get(language, _FALLBACK_CHECK_IN["fr"])
    goodbye = (silence.get("goodbye") or {}).get(language) or _FALLBACK_GOODBYE.get(language, _FALLBACK_GOODBYE["fr"])
    return check_in, goodbye


def silence_settings(cfg: Mapping[str, Any] | None) -> tuple[float, int]:
    """(seconds before the first check-in, check-ins before the goodbye)."""
    silence = (cfg or {}).get("silence") or {}
    seconds = silence.get("checkInSeconds")
    check_ins = silence.get("maxCheckIns")
    return (
        float(seconds) if isinstance(seconds, (int, float)) and seconds > 0 else 8.0,
        int(check_ins) if isinstance(check_ins, int) and check_ins >= 0 else 1,
    )
