"""TradeCatch AI receptionist — LiveKit voice agent.

Calls arrive from the Twilio SIP trunk. For each call this agent:
  1. finds out which business number was dialed,
  2. fetches that business's rendered instructions and transfer lines from
     TradeCatch (so every company is configured in the TradeCatch UI, not here),
  3. answers, and can really transfer the call with the `transfer_call` tool.

Required environment (see .env.example): TRADECATCH_BASE_URL, TRADECATCH_OPS_SECRET.
LiveKit credentials are provided by LiveKit Cloud.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Literal

import aiohttp
from dotenv import load_dotenv
from livekit import api, rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    RunContext,
    cli,
    function_tool,
    get_job_context,
    inference,
    room_io,
)
from livekit.plugins import ai_coustics

from routing import dialed_number, pick_transfer

logger = logging.getLogger("agent-tradecatch-receptionnist")

load_dotenv(".env.local")

CONFIG_TIMEOUT_SECONDS = 4

# Used only when TradeCatch cannot be reached. It must not promise anything the
# agent cannot do, and it offers no transfer (there is no vetted number to dial).
FALLBACK_INSTRUCTIONS = """You are the phone receptionist for a home-services contractor.
You are having technical difficulties and cannot look up the business's details.
Be brief and polite. Collect the caller's name, callback number, address and the reason
for the call, repeat them back, and say the team will call back. Never state prices,
availability or hours. If anyone is in danger, tell the caller to hang up and call 911.
You have no tools; never say you will transfer the call."""

FALLBACK_GREETING = "Thank you for calling. How can I help you?"


async def fetch_business_config(number: str) -> dict[str, Any] | None:
    base = os.environ.get("TRADECATCH_BASE_URL", "").rstrip("/")
    secret = os.environ.get("TRADECATCH_OPS_SECRET", "")
    if not base or not secret:
        logger.error("TRADECATCH_BASE_URL / TRADECATCH_OPS_SECRET are not set")
        return None
    try:
        timeout = aiohttp.ClientTimeout(total=CONFIG_TIMEOUT_SECONDS)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            async with http.get(
                f"{base}/api/receptionist/agent-config",
                params={"number": number},
                headers={
                    "Authorization": f"Bearer {secret}",
                    "X-Ops-Actor": "livekit-agent",
                },
            ) as res:
                if res.status != 200:
                    logger.error("agent-config returned %s for %s", res.status, number)
                    return None
                body = await res.json()
                return body.get("config")
    except Exception:
        logger.exception("could not fetch agent config")
        return None


class ReceptionistAgent(Agent):
    def __init__(
        self,
        cfg: dict[str, Any] | None,
        sip_identity: str | None,
    ) -> None:
        super().__init__(
            instructions=cfg["instructions"] if cfg else FALLBACK_INSTRUCTIONS,
        )
        self._cfg = cfg
        self._sip_identity = sip_identity
        self._transferring = False

    async def on_enter(self) -> None:
        greeting = (
            (self._cfg or {}).get("greetings", {}).get("en") or FALLBACK_GREETING
        )
        await self.session.generate_reply(
            instructions=(
                f'Greet the caller now by saying: "{greeting}" '
                "Then wait for their answer."
            ),
            allow_interruptions=True,
        )

    @function_tool()
    async def transfer_call(
        self,
        context: RunContext,
        reason: Literal["caller_request", "emergency"],
        department: str | None = None,
    ) -> str:
        """Connect the caller to a real person. Call this tool whenever the caller
        asks for a person, or in an emergency. Saying you will transfer without
        calling this tool does nothing.

        Args:
            reason: "emergency" for gas leaks, flooding, fire, injury or anything
                dangerous; otherwise "caller_request".
            department: Optional department name to offer, if the caller asked for one.
        """
        if self._cfg is None or not self._sip_identity:
            return (
                "Transfers are unavailable on this call. Apologize briefly and "
                "take the caller's details for a callback."
            )
        if self._transferring:
            return "A transfer is already in progress. Say nothing more."

        decision = pick_transfer(self._cfg, reason, department)
        if decision.number is None:
            return decision.refusal or "No transfer is possible. Offer a callback."

        self._transferring = True
        try:
            await context.session.generate_reply(
                instructions=(
                    "Tell the caller in one short sentence that you are connecting "
                    "them now."
                ),
                allow_interruptions=False,
            )
            job = get_job_context()
            await job.api.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=job.room.name,
                    participant_identity=self._sip_identity,
                    transfer_to=f"tel:{decision.number}",
                    play_dialtone=True,
                )
            )
            logger.info("transfer started (%s)", reason)
            return "The transfer has started. Say nothing more."
        except Exception:
            self._transferring = False
            logger.exception("SIP transfer failed")
            return (
                "The transfer failed. Tell the caller briefly that you could not "
                "connect them and offer to take their details for a callback."
            )


server = AgentServer()


@server.rtc_session(agent_name="tradecatch-receptionnist")
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    participant = await ctx.wait_for_participant(
        kind=rtc.ParticipantKind.PARTICIPANT_KIND_SIP
    )

    number = dialed_number(participant.attributes) or os.environ.get(
        "DEFAULT_BUSINESS_NUMBER"
    )
    cfg = await fetch_business_config(number) if number else None
    if cfg is None:
        logger.error("no TradeCatch config for dialed number; using safe fallback")

    session = AgentSession(
        llm=inference.DuplexModel(
            model="openai/gpt-live-1",
            voice="marin",
        ),
    )

    await session.start(
        agent=ReceptionistAgent(cfg, participant.identity),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=ai_coustics.audio_enhancement(
                    model=ai_coustics.EnhancerModel.QUAIL_VF_S,
                ),
            ),
        ),
    )


if __name__ == "__main__":
    cli.run_app(server)
