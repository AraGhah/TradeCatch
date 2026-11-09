"""Shared fixtures for the transfer test files (not a test module itself).

They reuse the call-flow harness in test_agent_flow: the real ReceptionistAgent with
a fake LiveKit session, a fake job (REFER / outbound-call API) and a fake TradeCatch
client. What they cannot show is a real phone ringing: that needs a live call.
"""

from __future__ import annotations

import logging

import agent as A
from test_agent_flow import WARM, FakeScreened, FlowCase

AGENT_LOGGER = "agent-tradecatch-receptionist"

FR_NORMAL = "Bien sûr, je vais vous transférer à un membre de notre équipe."
FR_EMERGENCY = (
    "Je comprends, c'est urgent. Je vais vous transférer immédiatement à notre contact d'urgence."
)
EN_NORMAL = "Of course. I'll connect you with someone from our team."
EN_EMERGENCY = "I understand this is urgent. I'll connect you with our emergency contact now."


class WarmCase(FlowCase):
    """Screened (warm) transfers, with LiveKit's task replaced by a script."""

    transfers = WARM

    async def asyncSetUp(self):
        await super().asyncSetUp()
        FakeScreened.script, FakeScreened.made, FakeScreened.hang = [], [], False
        self._real_screened = A.ScreenedTransfer
        A.ScreenedTransfer = FakeScreened
        self._real_pause = A.BETWEEN_ATTEMPTS_SECONDS
        A.BETWEEN_ATTEMPTS_SECONDS = 0.0

    async def asyncTearDown(self):
        A.ScreenedTransfer = self._real_screened
        A.BETWEEN_ATTEMPTS_SECONDS = self._real_pause
        await super().asyncTearDown()


def events(logs) -> list[str]:
    """The structured transfer events in an assertLogs capture, in order."""
    return [r.transfer["event"] for r in logs.records if hasattr(r, "transfer")]


def event_fields(logs, name: str) -> list[dict]:
    return [r.transfer for r in logs.records if getattr(r, "transfer", {}).get("event") == name]


def all_log_text(logs) -> str:
    return "\n".join(
        [r.getMessage() for r in logs.records]
        + [str(getattr(r, "transfer", "")) for r in logs.records]
    )


def capture(case):
    return case.assertLogs(AGENT_LOGGER, level=logging.DEBUG)
