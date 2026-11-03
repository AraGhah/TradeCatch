"""Call transfers on LiveKit: a screened warm transfer, and a checked SIP REFER fallback.

`ScreenedTransfer` builds on LiveKit's `WarmTransferTask`, which rings the contractor
on a second leg while the caller waits on hold, lets an assistant talk to whoever
picks up, and only then merges the two calls. What it adds for TradeCatch:

  * why a transfer failed (busy, no answer, wrong number...) is recorded from the SIP
    response, so the agent can tell the caller the truth;
  * the contractor must accept, by saying yes (the assistant calls connect_to_caller) or
    by pressing 1. A voicemail greeting counts as "answered" at the SIP layer, so a
    keypress is the one signal a recording cannot give;
  * every stage has a deadline, so a caller is never left on hold indefinitely;
  * the caller hanging up cancels the second leg instead of leaving a phone ringing.

LiveKit documents `WarmTransferTask` as beta and this file reaches into two of its
private methods (`_originate_human_agent`, `_set_result`, `_merge_calls`), so
requirements.txt pins the version it was written and tested against.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Any

from livekit import api, rtc
from livekit.agents import get_job_context
from livekit.agents.beta.workflows import WarmTransferResult, WarmTransferTask
from livekit.agents.llm import ToolError

from routing import TransferTarget
from transfer import (
    TransferFailure,
    TransferOutcome,
    TransferSettings,
    classify_sip_status,
    classify_tool_error,
    consult_instructions,
)

logger = logging.getLogger("tradecatch-transfer")

# Time allowed on top of the ring time for the room, the assistant and the SIP request.
SETUP_GRACE_SECONDS = 12.0
# Extra time the local client waits for LiveKit's own ringing timeout to be reported.
REPORT_GRACE_SECONDS = 8.0


class ScreenedTransfer(WarmTransferTask):
    """Ring `target`, confirm a person will take the call, then merge. Never hangs."""

    def __init__(
        self,
        *,
        target: TransferTarget,
        settings: TransferSettings,
        language_name: str,
        emergency: bool,
        facts: dict[str, Any],
        caller_id: str | None,
        business_name: str = "",
    ) -> None:
        super().__init__(
            sip_call_to=target.number,
            sip_trunk_id=settings.trunk_id,
            sip_number=caller_id or "",
            ringing_timeout=settings.ring_seconds,
            instructions=consult_instructions(
                language_name=language_name,
                emergency=emergency,
                facts=facts,
                target_name=target.name,
                business_name=business_name,
            ),
        )
        self.target = target
        self.failure: TransferFailure | None = None
        self.connected = False
        self._settings = settings
        self._timer: asyncio.TimerHandle | None = None
        self._merge_lock = asyncio.Lock()
        self._merged = False
        self._merging = False
        self._background: set[asyncio.Task[Any]] = set()

    # -- lifecycle -------------------------------------------------------

    async def on_enter(self) -> None:
        # Until someone answers, the whole attempt is bounded by the ring time.
        self._arm(self._settings.ring_seconds + SETUP_GRACE_SECONDS, "timeout")
        await super().on_enter()

    def _arm(self, seconds: float, kind: str) -> None:
        self._disarm()
        self._timer = asyncio.get_running_loop().call_later(seconds, self._expire, kind)

    def _disarm(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def _expire(self, kind: str) -> None:
        if self.done() or self._merging:
            return
        logger.warning("transfer attempt timed out (%s)", kind)
        self._fail(TransferFailure(kind))

    def _fail(self, failure: TransferFailure, detail: str = "transfer failed") -> None:
        if self.failure is None:
            self.failure = failure
        # Let on_enter stop waiting for a dial that will never be answered.
        with contextlib.suppress(asyncio.InvalidStateError):
            self._human_agent_failed_fut.set_result(None)
        self._set_result(ToolError(detail))

    def abort(self, kind: str = "caller_left") -> None:
        """The caller is gone (or the session is ending): drop the second leg."""
        if self.done():
            return
        self.failure = TransferFailure(kind)
        with contextlib.suppress(asyncio.InvalidStateError):
            self._human_agent_failed_fut.set_result(None)
        # The session may already be closing; releasing the second leg is what matters
        # and it happens before the call that can fail.
        with contextlib.suppress(Exception):
            self._set_result(ToolError(f"transfer ended: {kind}"))

    # -- dialing ---------------------------------------------------------

    async def _originate_human_agent(self, *, room_name: str, identity: str, room: Any) -> None:
        room.on("sip_dtmf_received", self._on_consult_key)
        started = time.monotonic()
        try:
            await asyncio.wait_for(
                super()._originate_human_agent(room_name=room_name, identity=identity, room=room),
                timeout=self._settings.ring_seconds + REPORT_GRACE_SECONDS,
            )
        except asyncio.TimeoutError:
            self.failure = TransferFailure("no_answer")
            raise
        except api.SipCallError as err:
            self.failure = classify_sip_status(err.sip_status_code)
            logger.warning(
                "transfer leg failed: sip %s after %.0fs",
                err.sip_status_code,
                time.monotonic() - started,
            )
            raise
        except Exception:
            self.failure = TransferFailure("provider_error")
            raise
        # Someone (or something) picked up. Now they must say yes within the deadline.
        logger.info("transfer leg answered after %.0fs", time.monotonic() - started)
        self._arm(self._settings.consult_seconds, "no_confirmation")

    # -- accepting -------------------------------------------------------

    def _on_consult_key(self, ev: Any) -> None:
        if getattr(ev, "digit", None) != "1" or self.done() or self._merged:
            return
        who = getattr(ev, "participant", None)
        if who is not None and getattr(who, "identity", None) != self._human_agent_identity:
            return
        logger.info("transfer accepted with a keypress")
        task = asyncio.get_running_loop().create_task(self._accept_by_key())
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def _accept_by_key(self) -> None:
        try:
            await self.connect_to_caller()
        except Exception:
            # _merge_calls has already ended the attempt with a failure.
            logger.exception("could not connect after the keypress")

    async def _merge_calls(self) -> None:
        async with self._merge_lock:
            if self._merged:
                return
            self._merging = True
            try:
                await super()._merge_calls()
                self._merged = True
            except Exception:
                self._merging = False
                self._fail(TransferFailure("provider_error"), "could not connect the calls")
                raise
            finally:
                self._merging = False

    def _set_result(self, result: WarmTransferResult | Exception) -> None:
        if self.done():
            return
        self._disarm()
        if isinstance(result, Exception):
            if self.failure is None:
                self.failure = classify_tool_error(str(result))
        else:
            self.connected = True
            self.failure = None
        super()._set_result(result)
        if self.connected:
            # The parent switches the caller's audio back on for the model. Two people
            # are now talking; the model must not hear them or answer for them.
            with contextlib.suppress(Exception):
                self._set_io_enabled(False)

    def outcome(self) -> TransferOutcome:
        if self.connected:
            return TransferOutcome(True, mechanism="warm")
        return TransferOutcome(
            False, self.failure or TransferFailure("provider_error"), mechanism="warm"
        )


def delete_room_when_a_party_leaves(room: Any) -> None:
    """End the call for everyone once the caller or the contractor hangs up.

    LiveKit's own task installs the same hook after a screened transfer. It is needed
    when the contractor is dialed straight into the caller's room, because the room
    would otherwise stay open (and the other person's phone connected) until it times out.
    """

    def on_left(participant: Any) -> None:
        if participant.kind not in _PARTY_KINDS:
            return
        room.off("participant_disconnected", on_left)
        logger.info("a party left the connected call; ending it")
        get_job_context().delete_room(room_name=room.name)

    room.on("participant_disconnected", on_left)


_PARTY_KINDS = (
    rtc.ParticipantKind.PARTICIPANT_KIND_SIP,
    rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD,
    rtc.ParticipantKind.PARTICIPANT_KIND_CONNECTOR,
)


# -- fallbacks that do not need a screening conversation ------------------


def _ringing(request: Any, seconds: float) -> None:
    request.ringing_timeout.FromNanoseconds(int(seconds * 1e9))


async def refer_transfer(
    *, identity: str, number: str, settings: TransferSettings
) -> TransferOutcome:
    """Hand the caller over with a SIP REFER, and read what LiveKit says happened.

    Only a SUCCESSFUL status counts. LiveKit reports the transfer's final status even
    when no exception is raised, and the old code ignored it. A voicemail greeting still
    counts as an answer here; the warm transfer is the way to screen for that.
    """
    job = get_job_context()
    request = api.TransferSIPParticipantRequest(
        room_name=job.room.name,
        participant_identity=identity,
        transfer_to=f"tel:{number}",
        play_dialtone=True,
    )
    _ringing(request, settings.ring_seconds)
    try:
        response = await job.api.sip.transfer_sip_participant(request)
    except api.SipCallError as err:
        return TransferOutcome(False, classify_sip_status(err.sip_status_code), "blind")
    except Exception:
        logger.exception("SIP REFER failed")
        return TransferOutcome(False, TransferFailure("provider_error"), "blind")

    status = api.SIPTransferStatus.Name(response.status)
    if status == "STS_TRANSFER_SUCCESSFUL":
        return TransferOutcome(True, mechanism="blind")
    reason = api.SIPTransferReason.Name(response.reason)
    logger.warning("SIP REFER did not complete: %s / %s", status, reason)
    sip_code = int(response.sip_status.code) if response.HasField("sip_status") else None
    if sip_code:
        failure = classify_sip_status(sip_code)
    elif reason == "STR_RINGING_TIMEOUT":
        failure = TransferFailure("no_answer")
    elif reason == "STR_REJECTED":
        failure = TransferFailure("declined")
    elif reason in ("STR_CALL_ENDED", "STR_CANCELED"):
        failure = TransferFailure("caller_left")
    else:
        failure = TransferFailure("provider_error")
    return TransferOutcome(False, failure, "blind")


async def bridge_without_screening(
    *, number: str, caller_id: str | None, settings: TransferSettings
) -> TransferOutcome:
    """Dial the contractor straight into the caller's room (used when the model has died).

    With no model there is nobody to screen the answer, so a voicemail greeting would
    look like a success. That is still better than dead air for a caller whose agent
    just failed, and it is only used on that path.
    """
    job = get_job_context()
    request = api.CreateSIPParticipantRequest(
        sip_trunk_id=settings.trunk_id,
        sip_call_to=number,
        room_name=job.room.name,
        participant_identity="transfer-target",
        wait_until_answered=True,
        play_dialtone=True,
        sip_number=caller_id or None,
    )
    _ringing(request, settings.ring_seconds)
    try:
        await asyncio.wait_for(
            job.api.sip.create_sip_participant(request),
            timeout=settings.ring_seconds + REPORT_GRACE_SECONDS,
        )
    except api.SipCallError as err:
        return TransferOutcome(False, classify_sip_status(err.sip_status_code), "bridge")
    except asyncio.TimeoutError:
        return TransferOutcome(False, TransferFailure("no_answer"), "bridge")
    except Exception:
        logger.exception("could not bridge the call")
        return TransferOutcome(False, TransferFailure("provider_error"), "bridge")
    return TransferOutcome(True, mechanism="bridge")
