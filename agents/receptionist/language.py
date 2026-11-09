"""Which language the call is in, decided from what the caller says (pure, no LiveKit imports).

There is no keypad menu. The agent greets in French and English at once; a
speech-to-text stream that listens to the caller reports, per utterance, which
language it heard, and this module turns those reports into one decision:

  * The first clear sentence decides the language. One or two short words
    ("allô", "hello", "oui") only count if two of them agree.
  * Once decided, a different language needs sustained evidence before the call
    switches: two clear utterances in a row (three right after the caller asked
    for a language out loud), or one long, confident one. A borrowed word, a name
    or a French sentence with "weekend" in it does not flip the call.
  * If nothing is clear after two utterances, the agent asks once, in both
    languages. The caller's next answer decides. If that does not settle it
    either, the call stays in the line's starting language and carries on.
  * If detection stops working, the call keeps the language it has and the agent
    is told to ask for itself when it is unsure.

An explicit request ("in English, please", the set_language tool) always wins
and is final until the caller asks again.

The thresholds below are starting points, chosen without recordings of real
callers. Measure them on real calls (see agents/receptionist/README.md) before
treating them as tuned.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Mapping, Sequence

# An utterance is "clear" with at least this many words and, when the recogniser
# reports one, this much confidence. Shorter speech is too easy to mislabel.
MIN_WORDS = 3
MIN_CONFIDENCE = 0.6
# One long, confident sentence in the other language is enough to switch on its own.
LONG_WORDS = 8
LONG_CONFIDENCE = 0.85
# Clear utterances in a row, in the other language, that switch a decided call.
SWITCH_STREAK = 2
SWITCH_STREAK_AFTER_REQUEST = 3
# Utterances heard without a decision before the agent asks which language.
ASK_AFTER = 2
# Utterances after the question that may still fail to settle it.
ASK_PATIENCE = 2


def detection_enabled(env: Mapping[str, str]) -> bool:
    """AGENT_LANGUAGE_DETECTION=off is the kill switch: no listener, the model follows the caller alone."""
    return (env.get("AGENT_LANGUAGE_DETECTION") or "").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def base_language(code: str | None) -> str | None:
    """"fr-CA" -> "fr", "EN_us" -> "en"; None for nothing."""
    if not code:
        return None
    primary = code.replace("_", "-").split("-", 1)[0].strip().lower()
    return primary or None


@dataclass(frozen=True)
class Heard:
    """One finished utterance, as far as the language logic cares: no words are kept."""

    language: str | None
    words: int
    confidence: float | None = None

    @property
    def clear(self) -> bool:
        return self.words >= MIN_WORDS and (
            self.confidence is None or self.confidence >= MIN_CONFIDENCE
        )

    @property
    def long_and_confident(self) -> bool:
        return (
            self.words >= LONG_WORDS
            and self.confidence is not None
            and self.confidence >= LONG_CONFIDENCE
        )


Action = Literal["set", "switch", "ask", "fallback"]


@dataclass(frozen=True)
class Verdict:
    """What the agent must do about the language, and why (the reason is logged)."""

    action: Action
    language: str | None
    reason: str
    # Utterances heard before this verdict, for measuring how quickly calls settle.
    heard: int


class CallLanguage:
    """The call's language: the start language until the caller's speech decides."""

    def __init__(
        self,
        languages: Sequence[str],
        start: str,
        *,
        detect: bool = True,
    ) -> None:
        self._languages = tuple(languages)
        self.start = start if start in self._languages or not self._languages else self._languages[0]
        self.language = self.start
        # A single-language line has nothing to decide.
        self.decided = len(self._languages) <= 1
        self._detect = detect and len(self._languages) > 1
        self.detection_failed = False
        self.asked = False
        self._explicit = False
        self._heard = 0
        self._after_ask = 0
        self._weak: list[Heard] = []
        self._streak_language: str | None = None
        self._streak = 0

    @property
    def detecting(self) -> bool:
        return self._detect and not self.detection_failed

    def observe(self, heard: Heard) -> Verdict | None:
        """One utterance. A Verdict when the agent has something to do, else None."""
        if not self.detecting:
            return None
        self._heard += 1
        language = base_language(heard.language)
        if language not in self._languages:
            language = None
        if not self.decided:
            return self._undecided(heard, language)
        return self._decided(heard, language)

    # -- before the first decision --------------------------------------

    def _undecided(self, heard: Heard, language: str | None) -> Verdict | None:
        if self.asked:
            return self._after_question(language)
        if language is not None and heard.clear:
            return self._decide(language, "clear_speech")
        if language is not None:
            self._weak.append(Heard(language, heard.words, heard.confidence))
            same = {h.language for h in self._weak[-2:]}
            if (
                len(self._weak) >= 2
                and len(same) == 1
                and sum(h.words for h in self._weak[-2:]) >= MIN_WORDS
            ):
                return self._decide(language, "short_utterances_agree")
        if self._heard >= ASK_AFTER:
            self.asked = True
            return Verdict("ask", None, "unclear", self._heard)
        return None

    def _after_question(self, language: str | None) -> Verdict | None:
        # The caller was asked "French or English?": whichever language the answer
        # is spoken in, however short, settles it.
        if language is not None:
            return self._decide(language, "answered_question")
        self._after_ask += 1
        if self._after_ask >= ASK_PATIENCE:
            self.decided = True
            return Verdict("fallback", self.start, "no_answer", self._heard)
        return None

    def _decide(self, language: str, reason: str) -> Verdict:
        self.decided = True
        self.language = language
        self._weak.clear()
        return Verdict("set", language, reason, self._heard)

    # -- after a decision -----------------------------------------------

    def _decided(self, heard: Heard, language: str | None) -> Verdict | None:
        if language is None or not heard.clear:
            return None  # too little to count for or against the current language
        if language == self.language:
            self._streak_language, self._streak = None, 0
            return None
        if self._streak_language == language:
            self._streak += 1
        else:
            self._streak_language, self._streak = language, 1
        needed = SWITCH_STREAK_AFTER_REQUEST if self._explicit else SWITCH_STREAK
        if self._streak >= needed or (heard.long_and_confident and not self._explicit):
            self.language = language
            self._streak_language, self._streak = None, 0
            return Verdict("switch", language, "sustained_speech", self._heard)
        return None

    # -- explicit requests and failure ----------------------------------

    def switch(self, language: str) -> bool:
        """The caller asked, out loud, for a language. True if the language changed."""
        if language not in self._languages:
            return False
        changed = language != self.language
        self.language = language
        self.decided = True
        self._explicit = True
        self._weak.clear()
        self._streak_language, self._streak = None, 0
        return changed

    def note_asked(self) -> None:
        """"French or English?" was said aloud (by the agent or the model): the next words answer it."""
        if self._detect and not self.decided:
            self.asked = True

    def fail(self) -> Verdict | None:
        """Detection stopped working: keep the language, stop deciding. Once."""
        if self.detection_failed or not self._detect:
            return None
        self.detection_failed = True
        was_decided = self.decided
        self.decided = True
        return Verdict(
            "fallback",
            self.language,
            "detector_unavailable" if was_decided else "detector_unavailable_undecided",
            self._heard,
        )
