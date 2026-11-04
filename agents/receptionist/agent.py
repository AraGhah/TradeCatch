"""TradeCatch AI receptionist — LiveKit voice agent.

Calls arrive from the Twilio SIP trunk. For each call this agent:
  1. finds out which business number was dialed,
  2. fetches that business's rendered instructions, opening words and transfer
     lines from TradeCatch (so every company is configured in the TradeCatch UI,
     not here),
  3. opens in the configured language with a menu (1 = English, 2 = French) and keeps the chosen language for the whole call,
  4. talks to the caller, books only through TradeCatch's calendar, and can
     really transfer the call,
  5. reports the finished call to TradeCatch, which sends the owner the usual
     summary and notifications.

Required environment (see .env.example): TRADECATCH_BASE_URL, TRADECATCH_OPS_SECRET.
LiveKit credentials are provided by LiveKit Cloud. Optional turn-taking and voice
tuning lives in tuning.py.

Voice: most calls use the realtime speech-to-speech model. A Receptionist Plus
business that cloned its owner's voice (and activated it) gets a speech-to-text ->
LLM -> ElevenLabs pipeline instead, because a speech-to-speech model cannot speak
with a custom voice. TradeCatch decides per call (`cfg["voice"]`, see voice.py);
if the cloned voice cannot be set up, or fails mid-call, the caller still gets an
answer in a standard voice.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from typing import Any, Coroutine, Literal

from dotenv import load_dotenv
from livekit import rtc
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
from livekit.agents.llm import ToolError
from livekit.agents.voice.events import CloseReason
from livekit.plugins import ai_coustics

import phrases
from call_record import CallRecord, is_e164
from language import LanguageChoice, LanguageMenu
from policy import SilencePolicy
from routing import (
    TransferPlan,
    TransferTarget,
    call_id_from_room,
    caller_number,
    dialed_number,
    plan_transfer,
)
from tool_results import format_availability, format_booking, parse_offers
from tradecatch_api import TradeCatchClient
from transfer import (
    TransferFailure,
    TransferOutcome,
    TransferSettings,
    failure_message,
    hold_line,
    transfer_settings,
)
from tuning import turn_handling_from_env, voice_settings
from voice import CustomVoice, cascade_settings, parse_custom_voice
from warm_transfer import (
    ScreenedTransfer,
    bridge_without_screening,
    delete_room_when_a_party_leaves,
    refer_transfer,
)

logger = logging.getLogger("agent-tradecatch-receptionist")

load_dotenv(".env.local")

# Used only when TradeCatch cannot be reached. It must not promise anything the
# agent cannot do, and it offers no transfer (there is no vetted number to dial).
FALLBACK_INSTRUCTIONS = """You are the phone receptionist for a home-services contractor.
You are having technical difficulties and cannot look up the business's details.
Be brief, warm and polite. Collect the caller's name, callback number, address and the
reason for the call. Explain that delivery is unconfirmed and ask them to try again.
Never state prices, availability or hours, and never say anything is
booked or confirmed. If anyone is in danger, tell the caller to hang up and call 911.
Never say you will transfer the call: no transfer is available."""

# A caller can ask again after a failed transfer, but not forever: each round holds
# the caller for up to the whole transfer budget.
MAX_TRANSFER_ROUNDS = 2
# How long the "please hold" line may take before ringing starts anyway.
HOLD_LINE_TIMEOUT_SECONDS = 10.0
# Every screening attempt uses the same side-room name and identity, and the previous
# room is deleted asynchronously. A short pause keeps a quick second attempt from
# joining a room that is still being torn down.
BETWEEN_ATTEMPTS_SECONDS = 1.5
# After a successful warm transfer this process stays only to hang up the second
# leg when either person leaves; this is the backstop if that never happens.
CONNECTED_JOB_MAX_SECONDS = 4 * 3600.0


class ReceptionistAgent(Agent):
    def __init__(
        self,
        *,
        cfg: dict[str, Any] | None,
        call: CallRecord,
        client: TradeCatchClient | None,
        sip_identity: str | None,
        transfers: TransferSettings | None = None,
    ) -> None:
        self._cfg: dict[str, Any] = cfg or {}
        self._has_config = cfg is not None
        self._base_instructions = cfg["instructions"] if cfg else FALLBACK_INSTRUCTIONS
        self._call = call
        self._client = client
        self._sip_identity = sip_identity
        self._transfer_settings = transfers or transfer_settings(os.environ)
        self._transfer_rounds = 0
        self._active_transfer: ScreenedTransfer | None = None
        # True once a person has the call. The process then stays alive only to end
        # the call when either side leaves.
        self._keep_job_alive = False

        self._menu = LanguageMenu(
            phrases.enabled_languages(cfg),
            phrases.start_language(cfg),
            phrases.menu_keys(cfg),
        )
        call.language = self._menu.language
        self.check_in_seconds, max_check_ins = phrases.silence_settings(cfg)
        self._silence = SilencePolicy(max_check_ins)

        self._ctx: JobContext | None = None
        self._opened = False
        self._pending_choice: LanguageChoice | None = None
        self._menu_task: asyncio.Task[None] | None = None
        self._tasks: set[asyncio.Task[Any]] = set()
        self._busy = 0
        self._book_lock = asyncio.Lock()
        self._transferring = False
        self._closing = False
        self._reported = False
        self._report_lock = asyncio.Lock()

        super().__init__(instructions=self._instructions_for(self._menu.language))

    # -- wiring ---------------------------------------------------------

    def attach(self, session: AgentSession, ctx: JobContext) -> None:
        """Subscribe to the call's events. Call before session.start()."""
        session.on("user_state_changed", self._on_user_state)
        session.on("conversation_item_added", self._on_item)
        session.on("close", self._on_close)
        session.on("error", lambda ev: logger.error("session error: %s", type(ev.error).__name__))
        ctx.room.on("sip_dtmf_received", self._on_dtmf)
        self._ctx = ctx

    def _instructions_for(self, language: str) -> str:
        return f"{self._base_instructions}\n\n{phrases.language_directive(language)}"

    def _spawn(self, work: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
        task = asyncio.create_task(work)
        self._tasks.add(task)

        def done(t: asyncio.Task[Any]) -> None:
            self._tasks.discard(t)
            if not t.cancelled() and t.exception() is not None:
                logger.error("background task failed", exc_info=t.exception())

        task.add_done_callback(done)
        return task

    @contextlib.asynccontextmanager
    async def _working(self):
        """A tool is waiting on TradeCatch: silence now is not the caller's."""
        self._busy += 1
        try:
            yield
        finally:
            self._busy -= 1
            with contextlib.suppress(Exception):
                self.session.reset_away_timer()

    # -- opening and language ------------------------------------------

    async def on_enter(self) -> None:
        self._opened = True
        if self._pending_choice is not None:
            # The caller pressed a key before the greeting started.
            await self._apply_choice(self._pending_choice)
            return
        opening = self.session.generate_reply(
            instructions=phrases.opening_instruction(self._cfg or None),
            allow_interruptions=True,
        )
        if self._menu.is_open:
            self._menu_task = self._spawn(self._run_menu(opening))

    async def _run_menu(self, opening: Any) -> None:
        """After the menu is spoken, wait a moment for a key; no key keeps the configured language."""
        await opening.wait_for_playout()
        await asyncio.sleep(phrases.menu_timeout_seconds(self._cfg or None))
        choice = self._menu.on_timeout()
        if choice is not None:
            # The greeting has finished playing; there is nothing to cut.
            await self._apply_choice(choice, cut_greeting=False)

    def _close_menu(self) -> None:
        if self._menu_task is not None and self._menu_task is not asyncio.current_task():
            self._menu_task.cancel()
        self._menu_task = None

    def _on_dtmf(self, ev: rtc.SipDTMF) -> None:
        if ev.participant is not None and self._sip_identity:
            if ev.participant.identity != self._sip_identity:
                return
        choice = self._menu.on_digit(ev.digit)
        if choice is None:
            return
        logger.info("language key pressed: %s", choice.language)
        self._close_menu()
        if not self._opened:
            self._pending_choice = choice
            return
        self._spawn(self._apply_choice(choice))

    async def _set_language(self, language: str) -> None:
        self._call.language = language
        try:
            await self.update_instructions(self._instructions_for(language))
        except Exception:
            # The next reply is still told its language explicitly.
            logger.exception("could not update instructions for the new language")

    async def _apply_choice(
        self, choice: LanguageChoice, *, cut_greeting: bool = True
    ) -> None:
        self._silence.on_activity()
        await self._set_language(choice.language)
        if cut_greeting:
            with contextlib.suppress(Exception):
                # A key press while the greeting plays: the caller already knows the menu.
                await self.session.interrupt(force=True)
        self.session.generate_reply(
            instructions=phrases.after_choice_instruction(
                self._cfg or None, choice.language, choice.chosen
            ),
            allow_interruptions=True,
        )

    # -- session events -------------------------------------------------

    def _on_user_state(self, ev: Any) -> None:
        if ev.new_state == "speaking":
            # Speech never picks the language; it only ends the wait for a key.
            self._menu.on_speech()
            self._close_menu()
            self._silence.on_activity()
        elif ev.new_state == "away" and not self._closing:
            self._spawn(self._on_quiet())

    async def _on_quiet(self) -> None:
        if self._transferring or self._busy > 0 or self._menu.is_open:
            self.session.reset_away_timer()
            return
        language = self._call.language
        check_in, goodbye = phrases.silence_texts(self._cfg or None, language)
        if self._silence.on_quiet() == "check_in":
            self.session.generate_reply(
                instructions=phrases.say_instruction(language, check_in),
                allow_interruptions=True,
            )
            return
        self._closing = True
        self._call.end_reason = "silence"
        speech = self.session.generate_reply(
            instructions=phrases.say_instruction(language, goodbye),
            allow_interruptions=False,
        )
        await speech.wait_for_playout()
        await self._hang_up()

    def _on_item(self, ev: Any) -> None:
        item = ev.item
        if getattr(item, "type", None) != "message":
            return
        speaker = {"user": "caller", "assistant": "agent"}.get(item.role)
        if speaker:
            self._call.add_turn(speaker, item.text_content)

    def _on_close(self, ev: Any) -> None:
        pending = self._active_transfer
        if pending is not None and not pending.done():
            # The caller left (or the model died) while a contractor's phone was ringing:
            # drop that second leg now, and report that no one was connected.
            pending.abort("caller_left")
            self._call.transfer = {"targetName": pending.target.name, "completed": False}
        if ev.reason == CloseReason.ERROR:
            logger.error("session closed with an error: %s", type(ev.error).__name__)
            self._call.end_reason = "error"
        elif self._call.end_reason is None:
            self._call.end_reason = (
                "caller_hung_up"
                if ev.reason == CloseReason.PARTICIPANT_DISCONNECTED
                else "completed"
            )
        self._spawn(self._after_close(ev.reason == CloseReason.ERROR))

    async def _after_close(self, failed: bool) -> None:
        if failed:
            await self._recover()
        await self.finish()
        if self._ctx is not None and not self._keep_job_alive:
            self._ctx.shutdown(reason="call ended")

    @property
    def transfer_settings(self) -> TransferSettings:
        return self._transfer_settings

    def _caller_id(self) -> str | None:
        """The number the contractor's phone shows: the configured one, else the business line."""
        return self._transfer_settings.caller_id or self._call.number or None

    async def _recover(self) -> None:
        """The model session died: connect the caller to a person if one can be reached.

        With no model there is nobody to screen the answer, so this is a direct
        connection. It is only used here, to avoid leaving the caller in dead air.
        """
        if self._keep_job_alive:
            return  # a person already has the call; the model failing no longer matters
        settings = self._transfer_settings
        plan = plan_transfer(
            self._cfg, "emergency" if self._call.emergency else "caller_request"
        )
        if not plan.targets or settings.mode == "off" or not self._sip_identity:
            await self._hang_up()
            return
        self._transferring = True
        target = plan.targets[0]
        if settings.mode == "warm":
            outcome = await bridge_without_screening(
                number=target.number, caller_id=self._caller_id(), settings=settings
            )
        else:
            outcome = await refer_transfer(
                identity=self._sip_identity, number=target.number, settings=settings
            )
        self._call.transfer = {"targetName": target.name, "completed": outcome.connected}
        if not outcome.connected:
            logger.error("recovery transfer failed (%s)", _why(outcome))
            await self._hang_up()
            return
        if outcome.mechanism == "bridge":
            self._stay_until_call_ends(watch_room=True)

    async def _hang_up(self) -> None:
        try:
            await get_job_context().delete_room()
        except Exception:
            logger.exception("could not end the call")

    async def finish(self) -> None:
        """Send the call to TradeCatch once, whatever way the call ended."""
        async with self._report_lock:
            if self._reported:
                return
            self._reported = True
        if self._client is None or not self._call.number:
            logger.error("call not reported: no TradeCatch connection or dialed number")
            return
        if self._call.end_reason is None:
            self._call.end_reason = "caller_hung_up"
        sent = await self._client.report(self._call.payload())
        if sent:
            logger.info("call reported (%s)", self._call.end_reason)
        else:
            logger.error("call report FAILED (%s)", self._call.end_reason)

    # -- tools ----------------------------------------------------------

    def _booking_enabled(self) -> bool:
        return bool(
            self._has_config and self._client is not None and self._cfg.get("bookingEnabled")
        )

    def _body(self, **fields: Any) -> dict[str, Any]:
        body: dict[str, Any] = {
            "number": self._call.number,
            "callId": self._call.call_id,
            "language": self._call.language,
        }
        if is_e164(self._call.from_e164):
            body["from"] = self._call.from_e164
        body.update({k: v for k, v in fields.items() if v})
        return body

    @function_tool()
    async def record_details(
        self,
        context: RunContext,
        caller_name: str | None = None,
        callback_number: str | None = None,
        callback_same_as_caller_id: bool = False,
        address: str | None = None,
        city: str | None = None,
        service: str | None = None,
        project: str | None = None,
        reason: str | None = None,
        preferred_time: str | None = None,
        email: str | None = None,
        message: str | None = None,
        emergency: bool = False,
    ) -> str:
        """Quietly save what the caller told you. Call it as soon as you learn a detail
        and again whenever they correct one. Never mention that you are saving it.
        Only send the fields you just learned.

        Args:
            caller_name: The caller's name.
            callback_number: Their callback number, as digits.
            callback_same_as_caller_id: True when they say to use the number they are calling from.
            address: Street address where the work is.
            city: City or neighbourhood.
            service: The service wanted (painting, plumbing...).
            project: What exactly needs doing, with size or rooms if given.
            reason: A one-line summary of why they called.
            preferred_time: The day and time they prefer, in their words.
            email: Their email address, only if they offered it.
            message: A message for the team, if they left one.
            emergency: True only when someone is in danger (gas, fire, flooding, injury).
        """
        rejected = self._call.update(
            caller_name=caller_name,
            callback_number=callback_number,
            address=address,
            city=city,
            service=service,
            project=project,
            reason=reason,
            preferred_time=preferred_time,
            email=email,
            message=message,
        )
        if callback_same_as_caller_id and not self._call.use_caller_number():
            rejected.append("callback_same_as_caller_id")
        if emergency:
            self._call.emergency = True
        if "callback_number" in rejected:
            return (
                "Saved, except the callback number: it is not a valid 10-digit number. "
                "Ask the caller to repeat it slowly, then record it again."
            )
        if "callback_same_as_caller_id" in rejected:
            return "The caller's own number is not available. Ask for a callback number."
        if "email" in rejected:
            return "Saved, except the email, which is not valid. Ask them to spell it."
        return "Saved."

    @function_tool()
    async def set_language(
        self, context: RunContext, language: Literal["fr", "en"]
    ) -> str:
        """Switch the call's language. Only when the caller clearly asks to continue in
        the other language (or accepts your offer to). Never because of an accent."""
        if language not in phrases.enabled_languages(self._cfg or None):
            return "That language is not available on this line. Say so politely."
        if not self._menu.switch(language):
            return "The call is already in that language. Carry on."
        self._close_menu()
        await self._set_language(language)
        name = phrases.LANGUAGE_NAMES.get(language, language)
        return (
            f"Switched. From now on speak only {name}. Do not greet again or repeat the "
            "menu. Acknowledge with one short word and carry on with the question you were on."
        )

    @function_tool()
    async def check_availability(
        self,
        context: RunContext,
        preferred_time: str | None = None,
        reason: str | None = None,
    ) -> str:
        """Look up real appointment openings in the calendar. Say a short phrase such as
        "one moment, I'm checking the calendar" first. Use it for any appointment or
        estimate request; never promise a time that this tool did not return.

        Args:
            preferred_time: The day and time the caller prefers, in their words, if any.
            reason: A short description of the job, if you have not recorded it yet.
        """
        if not self._booking_enabled():
            return format_availability({"ok": False, "reason": "booking_disabled"}, [])
        self._call.update(preferred_time=preferred_time, reason=reason)
        slots = self._call.report_slots()
        async with self._working():
            result = await self._client.availability(  # type: ignore[union-attr]
                self._body(
                    preferredTime=slots.get("preferredTime"),
                    issue=slots.get("issue"),
                    serviceAddress=slots.get("serviceAddress"),
                )
            )
        offers = parse_offers(result.get("offers")) if result and result.get("ok") else []
        if result and result.get("ok") and not offers:
            result = {"ok": False, "reason": "no_openings"}
        if offers and result:
            self._call.set_offers(
                offers, result.get("serviceId"), result.get("serviceName"), result.get("timezone")
            )
            self._call.availability_checked = True
        return format_availability(result, offers)

    @function_tool()
    async def book_appointment(self, context: RunContext, option: int) -> str:
        """Book one of the times returned by check_availability. Needs the caller's name,
        a valid callback number and the service address to be recorded first. Say a short
        phrase such as "one moment" first. Tell the caller it is booked only when this
        tool says BOOKED.

        Args:
            option: The number (1, 2, 3...) of the time the caller chose, from the list.
        """
        if self._call.booking:
            return (
                f"Already booked for {self._call.booking.get('label')}. "
                "Do not book again; just confirm it."
            )
        offer = self._call.offer(option)
        if offer is None:
            return (
                "That option number is not in the list. Re-read the times you were given, "
                "or call check_availability again, and ask which one they want."
            )
        slots = self._call.slots
        missing = [
            name
            for name, key in (
                ("name", "callerName"),
                ("callback number", "callbackE164"),
                ("service address", "serviceAddress"),
            )
            if not slots.get(key)
        ]
        if missing:
            return format_booking({"status": "missing_details", "missing": missing}, [])
        if not self._booking_enabled():
            return format_booking({"status": "request", "reason": "booking_disabled"}, [])

        async with self._book_lock, self._working():
            if self._call.booking:
                return f"Already booked for {self._call.booking.get('label')}."
            result = await self._client.book(  # type: ignore[union-attr]
                self._body(
                    startAt=offer.start_at,
                    serviceId=self._call.service_id,
                    serviceName=self._call.service_name,
                    timezone=self._call.timezone,
                    callerName=slots.get("callerName"),
                    callbackE164=slots.get("callbackE164"),
                    serviceAddress=slots.get("serviceAddress"),
                )
            )
        alternatives: list = []
        status = result.get("status") if result else None
        if status == "confirmed" and result:
            self._call.booking = {
                "appointmentId": str(result.get("appointmentId") or ""),
                "startAt": str(result.get("startAt") or offer.start_at),
                "label": str(result.get("label") or offer.label),
            }
        elif status == "taken" and result:
            alternatives = parse_offers(result.get("offers"))
            self._call.set_offers(alternatives, None, None, result.get("timezone"))
        return format_booking(result, alternatives)

    @function_tool()
    async def transfer_call(
        self,
        context: RunContext,
        reason: Literal["caller_request", "emergency"],
        department: str | None = None,
    ) -> str:
        """Connect the caller to a real person. Call this tool whenever the caller
        asks for a person, or in an emergency. Saying you will transfer without
        calling this tool does nothing. It rings the person while the caller waits
        on the line, and only connects them if the person accepts; the tool result
        says what really happened.

        Args:
            reason: "emergency" for gas leaks, flooding, fire, injury or anything
                dangerous; otherwise "caller_request".
            department: Optional department name to offer, if the caller asked for one.
        """
        emergency = reason == "emergency"
        if emergency:
            self._call.emergency = True
        if not self._has_config or not self._sip_identity:
            return (
                "Transfers are unavailable on this call. Apologize briefly and "
                "take the caller's details for a callback."
            )
        if self._keep_job_alive:
            return "The caller is already connected to a person. Say nothing more."
        if self._transferring:
            return "A transfer is already in progress. Say nothing more."

        plan = plan_transfer(self._cfg, reason, department)
        if not plan.targets:
            return plan.refusal or "No transfer is possible. Offer a callback."

        settings = self._transfer_settings
        if settings.mode == "off":
            # A configuration problem, not a business rule: make it loud in the logs.
            logger.error("transfer requested but unavailable: %s", settings.problem)
            self._call.transfer = {"targetName": plan.targets[0].name, "completed": False}
            return failure_message(
                TransferFailure("unavailable"),
                emergency=emergency,
                attempts=0,
                can_retry=False,
            )
        if self._transfer_rounds >= MAX_TRANSFER_ROUNDS:
            return failure_message(
                TransferFailure("no_answer"),
                emergency=emergency,
                attempts=0,
                can_retry=False,
            )

        self._transferring = True
        self._transfer_rounds += 1
        try:
            outcome, attempts, target = await self._run_transfer(
                context, plan, settings, emergency
            )
        finally:
            self._active_transfer = None
        if outcome.connected:
            self._call.transfer = {"targetName": target.name, "completed": True}
            self._call.end_reason = "completed"
            self._closing = True
            logger.info("transfer connected (%s, %s)", outcome.mechanism, target.name)
            if outcome.mechanism != "blind":
                # LiveKit's task has already installed the "either side left" hook.
                self._stay_until_call_ends(watch_room=False)
            self._leave_call()
            return "The caller is now connected to a person. Say nothing more."

        self._transferring = False
        self._call.transfer = {"targetName": target.name, "completed": False}
        failure = outcome.failure or TransferFailure("provider_error")
        logger.warning("transfer did not connect (%s)", _why(outcome))
        return failure_message(
            failure,
            emergency=emergency,
            attempts=attempts,
            can_retry=self._transfer_rounds < MAX_TRANSFER_ROUNDS,
        )

    async def _run_transfer(
        self,
        context: RunContext,
        plan: TransferPlan,
        settings: TransferSettings,
        emergency: bool,
    ) -> tuple[TransferOutcome, int, TransferTarget]:
        """Try each line in the plan until a person accepts. Never raises."""
        language = phrases.LANGUAGE_NAMES.get(self._call.language, self._call.language)
        started = time.monotonic()
        attempts = 0
        target = plan.targets[0]
        outcome = TransferOutcome(False, TransferFailure("provider_error"))
        try:
            # Hold the floor so nothing else is said while the person is being reached.
            async with context.foreground():
                await self._say_hold_line(context, hold_line(language, emergency))
                for candidate in plan.targets:
                    spent = time.monotonic() - started
                    if attempts and spent + settings.ring_seconds > settings.budget_seconds:
                        break
                    if attempts:
                        await asyncio.sleep(BETWEEN_ATTEMPTS_SECONDS)
                    target = candidate
                    attempts += 1
                    outcome = await self._attempt(target, settings, language, emergency)
                    if outcome.connected:
                        break
                    logger.info("transfer attempt %d failed (%s)", attempts, _why(outcome))
                    if outcome.failure is None or not outcome.failure.try_next:
                        break
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("transfer failed unexpectedly")
            outcome = TransferOutcome(False, TransferFailure("provider_error"))
        return outcome, attempts, target

    async def _say_hold_line(self, context: RunContext, instructions: str) -> None:
        """Tell the caller to hold. A slow or failed announcement never blocks ringing."""
        try:
            speech = context.session.generate_reply(
                instructions=instructions, allow_interruptions=False
            )

            async def finished() -> None:
                await speech

            waiter = self._spawn(finished())
            done, _ = await asyncio.wait({waiter}, timeout=HOLD_LINE_TIMEOUT_SECONDS)
            if not done:
                logger.warning("the hold announcement took too long; ringing anyway")
        except Exception:
            logger.warning("could not announce the hold", exc_info=True)

    async def _attempt(
        self,
        target: TransferTarget,
        settings: TransferSettings,
        language: str,
        emergency: bool,
    ) -> TransferOutcome:
        if settings.mode != "warm":
            return await refer_transfer(
                identity=self._sip_identity or "", number=target.number, settings=settings
            )
        task = ScreenedTransfer(
            target=target,
            settings=settings,
            language_name=language,
            emergency=emergency,
            facts=self._call.report_slots(),
            caller_id=self._caller_id(),
            business_name=str(self._cfg.get("businessName") or ""),
        )
        self._active_transfer = task
        try:
            await task
        except ToolError:
            pass  # the reason is on task.failure
        except asyncio.CancelledError:
            task.abort("caller_left")
            raise
        except Exception:
            logger.exception("screened transfer raised")
            task.abort("provider_error")
        finally:
            self._active_transfer = None
        return task.outcome()

    def _leave_call(self) -> None:
        """A person has the call: the model must neither listen nor speak, and ends."""
        session = self.session
        with contextlib.suppress(Exception):
            session.output.set_audio_enabled(False)
        with contextlib.suppress(Exception):
            session.input.set_audio_enabled(False)
        with contextlib.suppress(Exception):
            # Not delete_room: that would hang up on both of them.
            session.shutdown(drain=False)

    def _stay_until_call_ends(self, *, watch_room: bool) -> None:
        """Keep this process running so the call is ended when either side leaves.

        `watch_room` installs the hook that does that. A screened transfer already has
        one (LiveKit adds it when it merges the calls); a contractor dialed straight
        into the room does not.
        """
        self._keep_job_alive = True
        ctx = self._ctx
        if ctx is None:
            return
        if watch_room:
            with contextlib.suppress(Exception):
                delete_room_when_a_party_leaves(ctx.room)
        with contextlib.suppress(Exception):
            asyncio.get_running_loop().call_later(
                CONNECTED_JOB_MAX_SECONDS, ctx.shutdown, "connected call limit"
            )

    @function_tool()
    async def end_call(self, context: RunContext) -> str:
        """Hang up. Call this only after you have said goodbye and the caller has
        nothing left to ask. Never while a booking or transfer is in progress."""
        if self._transferring or self._busy > 0:
            return "Something is still in progress. Do not hang up yet."
        self._closing = True
        if self._call.end_reason is None:
            self._call.end_reason = "completed"
        await context.wait_for_playout()
        await self._hang_up()
        return "Call ended."


def _why(outcome: TransferOutcome) -> str:
    """A log-safe reason (no phone numbers, no caller speech)."""
    failure = outcome.failure
    if failure is None:
        return "connected" if outcome.connected else "unknown"
    code = f", sip {failure.sip_status}" if failure.sip_status else ""
    return f"{outcome.mechanism or 'transfer'}: {failure.kind}{code}"


server = AgentServer()


def prewarm(proc: Any) -> None:
    """Load the voice-activity model once per worker process, not once per call.

    Only the cloned-voice pipeline needs it; if the plugin is missing or fails
    to load, those calls use the standard voice and nothing else is affected.
    """
    try:
        from livekit.plugins import silero

        proc.userdata["vad"] = silero.VAD.load()
    except Exception:
        logger.warning("voice-activity model not preloaded; cloned voice unavailable", exc_info=True)


server.setup_fnc = prewarm


def build_custom_voice_session(
    custom: CustomVoice, vad: Any, options: dict[str, Any]
) -> AgentSession:
    """Speech-to-text -> LLM -> the owner's cloned ElevenLabs voice.

    The text-to-speech is wrapped in a fallback chain: if ElevenLabs errors or
    times out mid-call, the same sentence is spoken by a standard voice instead
    of leaving the caller in silence. Plugins are imported here so a deployment
    without them keeps working with the standard voice.
    """
    from livekit.agents import tts as lk_tts
    from livekit.plugins import elevenlabs

    settings = cascade_settings(os.environ)
    cloned = elevenlabs.TTS(
        voice_id=custom.voice_id,
        model=custom.model,
        api_key=os.environ["ELEVENLABS_API_KEY"],
    )
    return AgentSession(
        stt=inference.STT(settings.stt, language=settings.stt_language),
        llm=inference.LLM(settings.llm),
        tts=lk_tts.FallbackAdapter([cloned, inference.TTS(settings.fallback_tts)]),
        vad=vad,
        **options,
    )


def build_session(
    cfg: dict[str, Any] | None, vad: Any, options: dict[str, Any]
) -> AgentSession:
    """The session for this call: the owner's cloned voice when TradeCatch says so
    and it can be built, otherwise the standard realtime voice."""
    custom = parse_custom_voice(cfg, os.environ)
    if custom is not None and vad is not None:
        try:
            session = build_custom_voice_session(custom, vad, options)
            logger.info("answering with the business's custom voice (model %s)", custom.model)
            return session
        except Exception:
            # Never let a voice problem stop the call from being answered.
            logger.exception("custom voice unavailable; answering with the standard voice")
    elif custom is not None:
        logger.warning("custom voice requested but no voice-activity model; using standard voice")
    model, voice = voice_settings(os.environ)
    return AgentSession(llm=inference.DuplexModel(model=model, voice=voice), **options)


@server.rtc_session(agent_name="tradecatch-receptionist")
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    participant = await ctx.wait_for_participant(
        kind=rtc.ParticipantKind.PARTICIPANT_KIND_SIP
    )

    number = dialed_number(participant.attributes)
    client = TradeCatchClient.from_env()
    cfg = await client.fetch_business_config(number) if client and number else None
    if cfg is None:
        logger.error("no TradeCatch config for dialed number; using safe fallback")

    call = CallRecord(
        call_id=call_id_from_room(ctx.room.name, ctx.job.id),
        number=number or "",
        from_e164=caller_number(participant.attributes),
    )
    agent = ReceptionistAgent(
        cfg=cfg, call=call, client=client, sip_identity=participant.identity
    )
    settings = agent.transfer_settings
    if settings.problem:
        # Transfers are off or degraded by configuration: say so at the start of every
        # call, not only when a caller finally asks for a person.
        logger.warning("transfers: %s (mode %s)", settings.problem, settings.mode)

    options: dict[str, Any] = {"user_away_timeout": agent.check_in_seconds}
    turn_handling = turn_handling_from_env(os.environ)
    if turn_handling:
        options["turn_handling"] = turn_handling
    session = build_session(cfg, ctx.proc.userdata.get("vad"), options)

    agent.attach(session, ctx)
    # Backstop: the report goes out once even if the session never reports a close.
    ctx.add_shutdown_callback(agent.finish)

    await session.start(
        agent=agent,
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
