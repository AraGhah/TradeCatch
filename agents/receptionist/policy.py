"""Silence handling for the voice agent (pure, no LiveKit imports).

Mirrors the Twilio engine: a quiet caller is asked once "are you still there?",
and if the line stays quiet the call ends politely. It never loops forever and
never hangs up on the first pause.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SilencePolicy:
    max_check_ins: int = 1
    check_ins: int = 0

    def on_quiet(self) -> str:
        """The caller has been silent too long: "check_in" first, then "goodbye"."""
        if self.check_ins < self.max_check_ins:
            self.check_ins += 1
            return "check_in"
        return "goodbye"

    def on_activity(self) -> None:
        """The caller spoke: the next silence starts over with a check-in."""
        self.check_ins = 0
