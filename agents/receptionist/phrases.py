"""What the agent is told to say at fixed moments (pure, no LiveKit imports).

The words come from TradeCatch (`languageSelect` and `silence` in the agent
config). The fallbacks below only apply when an older server does not send those
blocks. The opening is bilingual and has no keypad menu: the caller's own speech
picks the language (see language.py).

A realtime model speaks in its own voice, so these are *instructions to say
exact text*, with the language each line must be spoken in.
"""

from __future__ import annotations

from typing import Any, Mapping

from persona import receptionist_name

LANGUAGE_NAMES = {"fr": "Canadian French (Québec)", "en": "North American English"}

_FALLBACK_QUESTION = {
    "fr": "Comment puis-je vous aider ?",
    "en": "How can I help you?",
}
_FALLBACK_CHECK_IN = {"fr": "Êtes-vous toujours là?", "en": "Are you still there?"}
_FALLBACK_GOODBYE = {
    "fr": "Je n'entends plus rien, alors je vais vous laisser. N'hésitez pas à rappeler. Au revoir!",
    "en": "I'm not hearing anything, so I'll let you go. Feel free to call back. Goodbye!",
}
# Spoken when the caller's language is still unclear after two utterances.
_FALLBACK_ASK = (
    {"lang": "fr", "text": "Français ou anglais?"},
    {"lang": "en", "text": "French or English?"},
)
# The one question both the system and the model may ask. Matches what either said.
ASK_MARKERS = ("french or english", "français ou anglais", "francais ou anglais")


def _select(cfg: Mapping[str, Any] | None) -> Mapping[str, Any]:
    return (cfg or {}).get("languageSelect") or {}


def start_language(cfg: Mapping[str, Any] | None) -> str:
    return _select(cfg).get("startLanguage") or "fr"


def enabled_languages(cfg: Mapping[str, Any] | None) -> list[str]:
    return list(_select(cfg).get("languages") or ["fr", "en"])


def _detection(cfg: Mapping[str, Any] | None) -> Mapping[str, Any]:
    return _select(cfg).get("detection") or {}


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


def _lines(raw: Any) -> list[tuple[str, str]]:
    """[{"lang": ..., "text": ...}] from the server, ignoring anything malformed."""
    if not isinstance(raw, list):
        return []
    return [
        (str(item.get("lang") or "fr"), item["text"])
        for item in raw
        if isinstance(item, dict) and isinstance(item.get("text"), str) and item["text"].strip()
    ]


def opening_lines(cfg: Mapping[str, Any] | None) -> list[tuple[str, str]]:
    """What the caller hears at pickup: French and English at once, no menu.

    "Bonjour, ici <business>." in French, then "How can I help you?" in English.
    A single-language line greets in that language and asks its question. An older
    server that sends no `detection` block gets the same words from the business name.
    """
    lines = _lines(_detection(cfg).get("opening"))
    if lines:
        return lines
    language = start_language(cfg)
    business = ((cfg or {}).get("businessName") or "").strip()
    who = receptionist_name(cfg)
    if len(enabled_languages(cfg)) <= 1:
        welcome = introduction(language, who, business)
        return [(language, welcome), (language, _FALLBACK_QUESTION[language])]
    return [("fr", introduction("fr", who, business)), ("en", "How can I help you?")]


def introduction(language: str, who: str, business: str) -> str:
    """"Bonjour, ici Lucie de <business>." / "Hello, this is Lucie from <business>." """
    if language == "en":
        return f"Hello, this is {who} from {business}." if business else f"Hello, this is {who}."
    return f"Bonjour, ici {who} de {business}." if business else f"Bonjour, ici {who}."


def opening_instruction(cfg: Mapping[str, Any] | None) -> str:
    """The bilingual greeting, spoken once. The caller's answer decides the language."""
    return _say_exactly(opening_lines(cfg))


def ask_lines(cfg: Mapping[str, Any] | None) -> list[tuple[str, str]]:
    return _lines(_detection(cfg).get("ask")) or [(i["lang"], i["text"]) for i in _FALLBACK_ASK]


def ask_instruction(cfg: Mapping[str, Any] | None) -> str:
    """"Français ou anglais? French or English?" when the caller's language is unclear."""
    return _say_exactly(ask_lines(cfg))


def spoken_ask(text: str | None) -> bool:
    """Did this agent turn already ask which language the caller prefers?"""
    lowered = (text or "").lower()
    return any(marker in lowered for marker in ASK_MARKERS)


def language_directive(language: str | None, *, detecting: bool = True) -> str:
    """Appended to the business instructions; replaced when the language changes.

    `language` is None until the caller's speech has decided it: the greeting was
    bilingual, so the model answers in whichever language the caller used.
    """
    if language is None:
        return (
            "# LANGUAGE OF THIS CALL\n"
            "The caller's language is not known yet. Your opening was spoken in French and in "
            "English. Reply in the language the caller speaks to you: Canadian French (Québec) "
            "for French, North American English for English. Do not switch because of an "
            "accent, a borrowed word or a name. If you cannot tell which of the two they "
            'speak, say exactly "Français ou anglais? French or English?" once and wait. '
            "Never repeat the greeting. "
            + _tool_rule(detecting)
            + "A later LANGUAGE UPDATE replaces this section."
        )
    name = LANGUAGE_NAMES.get(language, language)
    return (
        "# LANGUAGE OF THIS CALL\n"
        f"The call is in {name}. This current selection overrides any starting language "
        f"in the business prompt. Speak only {name}. "
        "Do not switch because of an accent, a borrowed word or a name. "
        + _tool_rule(detecting)
        + "If the caller speaks a language this line does not offer, say in French and in "
        "English that you can help in either, and ask which they prefer. "
        "Never repeat the greeting. "
        "A later LANGUAGE UPDATE replaces this section."
    )


def _tool_rule(detecting: bool) -> str:
    if detecting:
        return (
            "TradeCatch listens to the caller and sends a LANGUAGE UPDATE when the language "
            "changes. Call set_language yourself only when the caller asks, out loud, for "
            "the other language. "
        )
    return (
        "Switch, by calling set_language, when the caller asks for the other language or "
        "clearly talks to you in full sentences of it; then carry on with what you were doing. "
    )


def language_update(language: str) -> str:
    """A standing rule added mid-call, for a voice model whose instructions are fixed."""
    name = LANGUAGE_NAMES.get(language, language)
    return (
        "# LANGUAGE UPDATE\n"
        f"The call is now in {name}. This replaces the LANGUAGE OF THIS CALL section, any "
        "earlier language update and any starting language in the business prompt. "
        f"From now on speak only {name}, in every reply, including the business details "
        "you read from your instructions. Do not greet again."
    )


def detection_unavailable_update() -> str:
    """A standing rule added mid-call when automatic language detection stops working."""
    return (
        "# LANGUAGE UPDATE\n"
        "Automatic language detection is not available on this call. Keep the language the "
        "call is in. Switch, by calling set_language, when the caller asks for the other "
        "language or clearly talks to you in full sentences of it. If you cannot tell which "
        'language they speak, say exactly "Français ou anglais? French or English?" once.'
    )


def silence_texts(cfg: Mapping[str, Any] | None, language: str) -> tuple[str, str]:
    """(check-in, goodbye) in the call's language."""
    silence = (cfg or {}).get("silence") or {}
    check_in = (silence.get("checkIn") or {}).get(language) or _FALLBACK_CHECK_IN.get(language, _FALLBACK_CHECK_IN["fr"])
    goodbye = (silence.get("goodbye") or {}).get(language) or _FALLBACK_GOODBYE.get(language, _FALLBACK_GOODBYE["fr"])
    return check_in, goodbye


def quiet_instruction(cfg: Mapping[str, Any] | None, language: str | None, kind: str) -> str:
    """The check-in or goodbye ("check_in" / "goodbye"), in the call's language.

    Before the language is known the line is spoken in both languages, start language first.
    """
    index = 0 if kind == "check_in" else 1
    if language:
        return say_instruction(language, silence_texts(cfg, language)[index])
    first = start_language(cfg)
    order = [first] + [lang for lang in enabled_languages(cfg) if lang != first]
    return _say_exactly([(lang, silence_texts(cfg, lang)[index]) for lang in order[:2]])


def silence_settings(cfg: Mapping[str, Any] | None) -> tuple[float, int]:
    """(seconds before the first check-in, check-ins before the goodbye)."""
    silence = (cfg or {}).get("silence") or {}
    seconds = silence.get("checkInSeconds")
    check_ins = silence.get("maxCheckIns")
    return (
        float(seconds) if isinstance(seconds, (int, float)) and seconds > 0 else 8.0,
        int(check_ins) if isinstance(check_ins, int) and check_ins >= 0 else 1,
    )
