"""French-first language selection for the voice agent (pure, no LiveKit imports).

Mirrors src/product/receptionist/language-select.ts, which the Twilio engine uses:

* every call starts in French (when French is enabled), whatever the caller's number;
* the caller hears "... restez en ligne. For English, press 1.";
* key 1 = English, key 2 = French, any other key is ignored;
* no key within the wait = stay in French and ask the opening question;
* speech never chooses the language at the menu (a cough, a TV, or a caller who
  simply starts explaining must not flip the call);
* later, the model may call `set_language` when the caller clearly asks out loud.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

DEFAULT_KEYS: Mapping[str, str] = {"1": "en", "2": "fr"}


@dataclass(frozen=True)
class LanguageChoice:
    language: str
    # True when the caller pressed a key, so the choice is acknowledged out loud.
    chosen: bool


class LanguageMenu:
    """The window after the greeting in which a key can change the language."""

    def __init__(
        self,
        languages: Sequence[str],
        start: str,
        keys: Mapping[str, str] | None = None,
    ) -> None:
        self._languages = tuple(languages)
        self._keys = dict(keys or DEFAULT_KEYS)
        self.language = start if start in self._languages or not self._languages else self._languages[0]
        # A single-language line has no menu to wait for.
        self.is_open = len(self._languages) > 1

    def on_digit(self, digit: str) -> LanguageChoice | None:
        """A key during the window. Returns the choice, or None if it means nothing."""
        if not self.is_open:
            return None
        language = self._keys.get(digit)
        if language is None or language not in self._languages:
            return None
        self.language = language
        self.is_open = False
        return LanguageChoice(language, chosen=True)

    def on_speech(self) -> None:
        """The caller started talking: the window closes and the language stays."""
        self.is_open = False

    def on_timeout(self) -> LanguageChoice | None:
        """Nothing was pressed: stay in the start language."""
        if not self.is_open:
            return None
        self.is_open = False
        return LanguageChoice(self.language, chosen=False)

    def switch(self, language: str) -> bool:
        """The caller asked, out loud, for the other language. True if it changed."""
        self.is_open = False
        if language not in self._languages or language == self.language:
            return False
        self.language = language
        return True
