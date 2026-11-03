"""Call-flow tests for the voice agent, with a fake LiveKit session and fake TradeCatch.

They exercise the real ReceptionistAgent (language menu, silence, tools, report)
without a network. What they cannot show is how the realtime model *sounds* or
whether Twilio delivers the keypress: that needs a live call.
"""

import asyncio
import contextlib
import copy
import time
import unittest
from types import SimpleNamespace

try:
    import agent as A
    import warm_transfer as W
    from call_record import CallRecord
    from livekit import api
    from livekit.agents.llm import ToolError
    from transfer import TransferFailure, TransferSettings
except ImportError as err:  # livekit-agents is not installed here
    raise unittest.SkipTest(f"livekit-agents unavailable: {err}")

CFG = {
    "instructions": "Base prompt.",
    "bookingEnabled": True,
    "afterHours": False,
    "transferE164": "+14389957350",
    "emergencyTransferE164": "+14385550001",
    "departments": [{"name": "Billing", "phoneE164": "+14385550002"}],
    "languageSelect": {
        "startLanguage": "fr",
        "languages": ["fr", "en"],
        "timeoutSeconds": 0.02,
        "keys": {"1": "en", "2": "fr"},
        "opening": {
            "statement": {"text": "Bonjour! Merci d'avoir appelé Acme.", "lang": "fr"},
            "menu": [
                {"text": "Pour continuer en français, restez en ligne.", "lang": "fr"},
                {"text": "For English, press 1.", "lang": "en"},
            ],
        },
        "afterChoice": {
            "fr": {"chosen": "Très bien, en français.", "afterHoursNotice": "", "question": "Comment puis-je vous aider?"},
            "en": {"chosen": "Sure, English.", "afterHoursNotice": "", "question": "How can I help?"},
        },
    },
    "silence": {
        "checkInSeconds": 8,
        "maxCheckIns": 1,
        "checkIn": {"fr": "Êtes-vous toujours là?", "en": "Are you still there?"},
        "goodbye": {"fr": "Au revoir!", "en": "Goodbye!"},
    },
}

OFFERS = [
    {"startAt": "2026-11-03T14:00:00Z", "label": "mardi à 9 h"},
    {"startAt": "2026-11-03T18:30:00Z", "label": "mardi à 13 h 30"},
]


class FakeHandle:
    async def wait_for_playout(self):
        return None

    def __await__(self):
        return self.wait_for_playout().__await__()


class FakeAudio:
    def __init__(self):
        self.enabled = True

    def set_audio_enabled(self, value):
        self.enabled = value


class FakeSession:
    def __init__(self):
        self.replies: list[str] = []
        self.interrupts = 0
        self.away_resets = 0
        self.shutdowns: list[bool] = []
        self.input = FakeAudio()
        self.output = FakeAudio()
        self.handle_factory = FakeHandle

    def generate_reply(self, *, instructions, allow_interruptions=True, **_):
        self.replies.append(instructions)
        return self.handle_factory()

    async def interrupt(self, force=False):
        self.interrupts += 1

    def reset_away_timer(self):
        self.away_resets += 1

    def shutdown(self, *, drain=True):
        self.shutdowns.append(drain)


class FakeContext:
    """The RunContext a tool receives: the session, and the floor it can hold."""

    def __init__(self, session):
        self.session = session
        self.floors = 0

    @contextlib.asynccontextmanager
    async def foreground(self):
        self.floors += 1
        yield


class FakeClient:
    def __init__(self):
        self.availability_calls: list[dict] = []
        self.book_calls: list[dict] = []
        self.reports: list[dict] = []
        self.availability_result = {
            "ok": True,
            "timezone": "America/Toronto",
            "serviceId": "svc_1",
            "serviceName": "Estimation",
            "matchesRequest": True,
            "offers": OFFERS,
        }
        self.book_result = {
            "status": "confirmed",
            "appointmentId": "apt_1",
            "startAt": OFFERS[0]["startAt"],
            "label": "mardi à 9 h",
        }

    async def availability(self, body):
        self.availability_calls.append(body)
        return self.availability_result

    async def book(self, body):
        self.book_calls.append(body)
        return self.book_result

    async def report(self, body):
        self.reports.append(body)
        return True


def refer_response(status="STS_TRANSFER_SUCCESSFUL", reason="STR_COMPLETED", sip=None):
    """What LiveKit returns for a SIP REFER, built from the real message type."""
    response = api.TransferSIPParticipantResponse(
        status=api.SIPTransferStatus.Value(status), reason=api.SIPTransferReason.Value(reason)
    )
    if sip:
        response.sip_status.code = sip
    return response


def sip_call_error(code):
    return api.SipCallError(
        "unavailable", "call failed", status=503, metadata={"sip_status_code": str(code)}
    )


class FakeRoom:
    def __init__(self, name="call-room"):
        self.name = name
        self.handlers: dict[str, list] = {}

    def on(self, event, handler):
        self.handlers.setdefault(event, []).append(handler)

    def off(self, event, handler):
        if handler in self.handlers.get(event, []):
            self.handlers[event].remove(handler)


class FakeJob:
    def __init__(self, transfer_error=None):
        self.deleted = 0
        self.deleted_rooms: list[str] = []
        self.transfers: list[str] = []
        self.refer_requests: list = []
        self.bridges: list = []
        self.shutdowns: list[str] = []
        self.room = FakeRoom()
        self.transfer_error = transfer_error
        self.transfer_response = refer_response()
        # One entry per REFER, in order: a response, or an exception to raise.
        self.transfer_queue: list = []
        self.bridge_error = None

        async def transfer(request):
            if self.transfer_error:
                raise self.transfer_error
            self.transfers.append(request.transfer_to)
            self.refer_requests.append(request)
            result = self.transfer_queue.pop(0) if self.transfer_queue else self.transfer_response
            if isinstance(result, Exception):
                raise result
            return result

        async def create_participant(request):
            self.bridges.append(request)
            if self.bridge_error:
                raise self.bridge_error

        self.api = SimpleNamespace(
            sip=SimpleNamespace(
                transfer_sip_participant=transfer, create_sip_participant=create_participant
            )
        )

    def delete_room(self, room_name=None):
        # Like the real one, returns a future: callers may await it or ignore it.
        self.deleted += 1
        if room_name:
            self.deleted_rooms.append(room_name)
        done = asyncio.get_running_loop().create_future()
        done.set_result(None)
        return done

    def shutdown(self, reason=""):
        self.shutdowns.append(reason)


class Harness(A.ReceptionistAgent):
    """The real agent with the session swapped for a fake."""

    fake_session = None
    session = property(lambda self: self.fake_session)


def dtmf(digit):
    return SimpleNamespace(digit=digit, participant=None)


def state(new_state):
    return SimpleNamespace(new_state=new_state)


class FlowCase(unittest.IsolatedAsyncioTestCase):
    cfg = CFG
    # Tests never read the machine's environment: REFER unless a test says otherwise.
    transfers = TransferSettings(mode="blind", ring_seconds=25, budget_seconds=100)

    async def asyncSetUp(self):
        self.client = FakeClient()
        self.job = FakeJob()
        self._patch = A.get_job_context
        A.get_job_context = lambda: self.job
        self._patch_wt = W.get_job_context
        W.get_job_context = lambda: self.job
        self.call = CallRecord(call_id="call-abc123", number="+14382314700", from_e164="+15145550142")
        self.make_agent()

    async def asyncTearDown(self):
        A.get_job_context = self._patch
        W.get_job_context = self._patch_wt
        for task in list(self.agent._tasks):
            task.cancel()
        await asyncio.sleep(0)

    def make_agent(self, cfg=None, client="default", transfers=None):
        self.agent = Harness(
            cfg=copy.deepcopy(self.cfg if cfg is None else cfg),
            call=self.call,
            client=self.client if client == "default" else client,
            sip_identity="sip_1",
            transfers=transfers or self.transfers,
        )
        self.agent.fake_session = FakeSession()
        self.agent._ctx = self.job
        self.session = self.agent.fake_session
        return self.agent

    async def settle(self):
        """Let spawned tasks (timers, replies) run to completion."""
        for _ in range(5):
            await asyncio.sleep(0.05)
        pending = [t for t in self.agent._tasks if not t.done()]
        if pending:
            await asyncio.wait(pending, timeout=1)


class OpeningAndLanguageTests(FlowCase):
    async def test_every_call_opens_in_french_with_the_menu(self):
        await self.agent.on_enter()
        opening = self.session.replies[0]
        self.assertLess(opening.index("Bonjour! Merci d'avoir appelé Acme."), opening.index("For English, press 1."))
        self.assertIn("Canadian French", self.agent.instructions)
        self.assertEqual(self.call.language, "fr")

    async def test_no_key_stays_in_french_and_asks_the_question_once(self):
        await self.agent.on_enter()
        await self.settle()
        self.assertEqual(len(self.session.replies), 2)
        self.assertIn("Comment puis-je vous aider?", self.session.replies[1])
        self.assertNotIn("Très bien", self.session.replies[1])
        self.assertEqual(self.call.language, "fr")

    async def test_key_1_switches_to_english_without_replaying_the_greeting(self):
        await self.agent.on_enter()
        self.agent._on_dtmf(dtmf("1"))
        await self.settle()
        self.assertEqual(self.call.language, "en")
        self.assertIn("North American English", self.agent.instructions)
        self.assertEqual(self.session.interrupts, 1)
        # opening + one English reply; the French timeout must not fire afterwards.
        self.assertEqual(len(self.session.replies), 2)
        self.assertIn("Sure, English.", self.session.replies[1])
        self.assertIn("How can I help?", self.session.replies[1])
        self.assertNotIn("Bonjour", self.session.replies[1])

    async def test_key_2_confirms_french(self):
        await self.agent.on_enter()
        self.agent._on_dtmf(dtmf("2"))
        await self.settle()
        self.assertEqual(self.call.language, "fr")
        self.assertEqual(len(self.session.replies), 2)
        self.assertIn("Très bien, en français.", self.session.replies[1])

    async def test_other_keys_are_ignored(self):
        await self.agent.on_enter()
        self.agent._on_dtmf(dtmf("7"))
        self.agent._on_dtmf(dtmf("#"))
        await self.settle()
        self.assertEqual(self.call.language, "fr")
        self.assertEqual(self.session.interrupts, 0)

    async def test_a_key_after_the_menu_closed_does_nothing(self):
        await self.agent.on_enter()
        await self.settle()
        before = len(self.session.replies)
        self.agent._on_dtmf(dtmf("1"))
        await self.settle()
        self.assertEqual(len(self.session.replies), before)
        self.assertEqual(self.call.language, "fr")

    async def test_speech_at_the_menu_does_not_pick_a_language_or_trigger_a_second_greeting(self):
        await self.agent.on_enter()
        self.agent._on_user_state(state("speaking"))
        await self.settle()
        self.assertEqual(self.call.language, "fr")
        self.assertEqual(len(self.session.replies), 1)

    async def test_a_key_pressed_before_the_greeting_starts_skips_the_greeting(self):
        self.agent._on_dtmf(dtmf("1"))
        await self.agent.on_enter()
        await self.settle()
        self.assertEqual(self.call.language, "en")
        self.assertEqual(len(self.session.replies), 1)
        self.assertNotIn("Bonjour", self.session.replies[0])

    async def test_dtmf_from_another_participant_is_ignored(self):
        await self.agent.on_enter()
        self.agent._on_dtmf(SimpleNamespace(digit="1", participant=SimpleNamespace(identity="someone-else")))
        await self.settle()
        self.assertEqual(self.call.language, "fr")

    async def test_the_caller_can_switch_language_mid_call(self):
        await self.agent.on_enter()
        await self.settle()
        reply = await self.agent.set_language(None, "en")
        self.assertIn("Switched", reply)
        self.assertEqual(self.call.language, "en")
        self.assertIn("North American English", self.agent.instructions)
        self.assertIn("Do not greet again", reply)
        # Asking for the same language again changes nothing.
        self.assertIn("already", (await self.agent.set_language(None, "en")).lower())

    async def test_a_language_the_line_does_not_offer_is_refused(self):
        cfg = copy.deepcopy(CFG)
        cfg["languageSelect"]["languages"] = ["fr"]
        cfg["languageSelect"]["opening"]["menu"] = []
        self.make_agent(cfg)
        self.assertIn("not available", await self.agent.set_language(None, "en"))
        self.assertEqual(self.call.language, "fr")

    async def test_a_single_language_line_has_no_menu_wait(self):
        cfg = copy.deepcopy(CFG)
        cfg["languageSelect"].update(startLanguage="en", languages=["en"])
        cfg["languageSelect"]["opening"] = {"statement": {"text": "Hello, Acme.", "lang": "en"}, "menu": []}
        self.make_agent(cfg)
        await self.agent.on_enter()
        await self.settle()
        self.assertEqual(len(self.session.replies), 1)
        self.assertIn("How can I help?", self.session.replies[0])

    async def test_an_older_server_without_language_settings_still_opens_french_first(self):
        self.make_agent({"instructions": "Base prompt."})
        await self.agent.on_enter()
        self.assertIn("restez en ligne", self.session.replies[0])
        self.assertEqual(self.call.language, "fr")

    async def test_no_config_at_all_uses_the_safe_fallback(self):
        self.make_agent(None)
        self.agent = Harness(cfg=None, call=self.call, client=None, sip_identity="sip_1")
        self.agent.fake_session = FakeSession()
        self.session = self.agent.fake_session
        await self.agent.on_enter()
        self.assertIn("technical difficulties", self.agent.instructions)
        self.assertIn("Bonjour", self.session.replies[0])
        self.assertIn("no transfer is available", self.agent.instructions)
        self.assertIn("Transfers are unavailable", await self.agent.transfer_call(None, "caller_request"))


class SilenceTests(FlowCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self.agent.on_enter()
        await self.settle()
        self.session.replies.clear()

    async def test_checks_in_once_then_says_goodbye_and_hangs_up(self):
        self.agent._on_user_state(state("away"))
        await self.settle()
        self.assertEqual(len(self.session.replies), 1)
        self.assertIn("Êtes-vous toujours là?", self.session.replies[0])
        self.assertEqual(self.job.deleted, 0)

        self.agent._on_user_state(state("away"))
        await self.settle()
        self.assertIn("Au revoir!", self.session.replies[1])
        self.assertEqual(self.job.deleted, 1)
        self.assertEqual(self.call.end_reason, "silence")

    async def test_the_check_in_is_in_the_calls_language(self):
        await self.agent.set_language(None, "en")
        self.session.replies.clear()
        self.agent._on_user_state(state("away"))
        await self.settle()
        self.assertIn("Are you still there?", self.session.replies[0])

    async def test_a_caller_who_speaks_gets_a_fresh_check_in_next_time(self):
        self.agent._on_user_state(state("away"))
        await self.settle()
        self.agent._on_user_state(state("speaking"))
        self.agent._on_user_state(state("away"))
        await self.settle()
        self.assertIn("toujours là", self.session.replies[-1])
        self.assertEqual(self.job.deleted, 0)

    async def test_silence_is_ignored_while_a_tool_is_waiting_or_a_transfer_runs(self):
        self.agent._busy = 1
        self.agent._on_user_state(state("away"))
        await self.settle()
        self.assertEqual(self.session.replies, [])
        self.assertEqual(self.session.away_resets, 1)
        self.agent._busy = 0
        self.agent._transferring = True
        self.agent._on_user_state(state("away"))
        await self.settle()
        self.assertEqual(self.session.replies, [])

    async def test_no_check_in_after_the_call_is_already_ending(self):
        self.agent._closing = True
        self.agent._on_user_state(state("away"))
        await self.settle()
        self.assertEqual(self.session.replies, [])


class BookingTests(FlowCase):
    def give_details(self):
        self.call.update(
            caller_name="Marie Tremblay",
            callback_number="514 555 0199",
            address="12 rue des Pins, Laval",
            reason="peinture de cuisine",
        )

    async def test_availability_returns_only_real_times_and_remembers_them(self):
        self.give_details()
        text = await self.agent.check_availability(None, preferred_time="mardi matin")
        self.assertIn("1. mardi à 9 h", text)
        self.assertIn("2. mardi à 13 h 30", text)
        body = self.client.availability_calls[0]
        self.assertEqual(body["number"], "+14382314700")
        self.assertEqual(body["callId"], "call-abc123")
        self.assertEqual(body["from"], "+15145550142")
        self.assertEqual(body["language"], "fr")
        self.assertEqual(body["preferredTime"], "mardi matin")
        self.assertEqual(body["serviceAddress"], "12 rue des Pins, Laval")
        self.assertEqual(self.call.offer(2).label, "mardi à 13 h 30")

    async def test_no_openings_is_never_turned_into_a_made_up_time(self):
        self.client.availability_result = {"ok": False, "reason": "no_openings"}
        text = await self.agent.check_availability(None)
        self.assertIn("Do NOT invent a time", text)
        self.assertEqual(self.call.offers, [])

    async def test_a_dead_calendar_gets_an_honest_answer(self):
        self.client.availability_result = None
        text = await self.agent.check_availability(None)
        self.assertIn("did not respond", text)
        self.assertIn("Do NOT say anything is booked", text)

    async def test_booking_is_off_when_the_owner_has_not_enabled_it(self):
        cfg = copy.deepcopy(CFG)
        cfg["bookingEnabled"] = False
        self.make_agent(cfg)
        self.assertIn("not available", await self.agent.check_availability(None))
        self.assertEqual(self.client.availability_calls, [])

    async def test_confirmed_booking_is_recorded_and_allows_saying_booked(self):
        self.give_details()
        await self.agent.check_availability(None)
        text = await self.agent.book_appointment(None, 1)
        self.assertTrue(text.startswith("BOOKED."))
        body = self.client.book_calls[0]
        self.assertEqual(body["startAt"], OFFERS[0]["startAt"])
        self.assertEqual(body["callerName"], "Marie Tremblay")
        self.assertEqual(body["callbackE164"], "+15145550199")
        self.assertEqual(body["serviceId"], "svc_1")
        self.assertEqual(body["timezone"], "America/Toronto")
        self.assertTrue(self.call.booked)
        self.assertEqual(self.call.payload()["intent"], "appointment")

    async def test_a_second_booking_attempt_is_refused(self):
        self.give_details()
        await self.agent.check_availability(None)
        await self.agent.book_appointment(None, 1)
        again = await self.agent.book_appointment(None, 2)
        self.assertIn("Already booked", again)
        self.assertEqual(len(self.client.book_calls), 1)

    async def test_the_model_cannot_book_a_time_that_was_never_offered(self):
        self.give_details()
        await self.agent.check_availability(None)
        self.assertIn("not in the list", await self.agent.book_appointment(None, 7))
        self.assertIn("not in the list", await self.agent.book_appointment(None, 0))
        self.assertEqual(self.client.book_calls, [])

    async def test_booking_without_offers_is_refused(self):
        self.give_details()
        self.assertIn("not in the list", await self.agent.book_appointment(None, 1))

    async def test_missing_details_are_asked_for_without_calling_the_server(self):
        await self.agent.check_availability(None)
        text = await self.agent.book_appointment(None, 1)
        self.assertIn("missing", text)
        self.assertIn("the caller's name", text)
        self.assertEqual(self.client.book_calls, [])
        self.assertFalse(self.call.booked)

    async def test_a_taken_slot_offers_the_new_alternatives_and_books_none(self):
        self.give_details()
        await self.agent.check_availability(None)
        self.client.book_result = {
            "status": "taken",
            "timezone": "America/Toronto",
            "offers": [{"startAt": "2026-11-04T15:00:00Z", "label": "mercredi à 10 h"}],
        }
        text = await self.agent.book_appointment(None, 1)
        self.assertIn("NOT booked", text)
        self.assertIn("1. mercredi à 10 h", text)
        self.assertFalse(self.call.booked)
        # The old option 2 is gone: only what the server just offered can be booked.
        self.assertIsNone(self.call.offer(2))
        self.assertEqual(self.call.offer(1).label, "mercredi à 10 h")

    async def test_a_booking_api_failure_never_claims_a_booking(self):
        self.give_details()
        await self.agent.check_availability(None)
        self.client.book_result = None
        text = await self.agent.book_appointment(None, 1)
        self.assertIn("NOT booked", text)
        self.assertNotIn("BOOKED", text)
        self.assertFalse(self.call.booked)
        self.assertNotEqual(self.call.payload().get("intent"), None)

    async def test_busy_flag_is_cleared_after_a_tool_even_when_it_fails(self):
        self.give_details()

        async def boom(body):
            raise RuntimeError("down")

        self.client.availability = boom
        with self.assertRaises(RuntimeError):
            await self.agent.check_availability(None)
        self.assertEqual(self.agent._busy, 0)


class RecordDetailsTests(FlowCase):
    async def test_details_are_saved_silently_and_validated(self):
        self.assertEqual(
            await self.agent.record_details(None, caller_name="Marie", callback_number="514-555-0199"),
            "Saved.",
        )
        self.assertEqual(self.call.slots["callbackE164"], "+15145550199")

    async def test_a_misheard_number_is_sent_back_for_a_repeat(self):
        text = await self.agent.record_details(None, callback_number="555-019")
        self.assertIn("repeat it slowly", text)
        self.assertNotIn("callbackE164", self.call.slots)

    async def test_the_callers_own_number_can_be_reused(self):
        await self.agent.record_details(None, callback_same_as_caller_id=True)
        self.assertEqual(self.call.slots["callbackE164"], "+15145550142")

    async def test_a_withheld_caller_id_cannot_be_reused(self):
        self.call.from_e164 = None
        text = await self.agent.record_details(None, callback_same_as_caller_id=True)
        self.assertIn("not available", text)

    async def test_an_emergency_is_flagged_for_the_owner(self):
        await self.agent.record_details(None, reason="fuite de gaz", emergency=True)
        self.assertTrue(self.call.payload()["emergency"])


def ctx_for(session):
    return FakeContext(session)


class TransferTests(FlowCase):
    """The SIP REFER path (no outbound trunk): the result LiveKit reports is what counts."""

    async def test_a_completed_handoff_connects_the_call_and_the_agent_leaves(self):
        ctx = ctx_for(self.session)
        reply = await self.agent.transfer_call(ctx, "caller_request")
        self.assertIn("now connected", reply)
        self.assertEqual(self.job.transfers, ["tel:+14389957350"])
        self.assertEqual(self.call.transfer, {"targetName": "General line", "completed": True})
        self.assertEqual(self.call.end_reason, "completed")
        self.assertEqual(self.session.shutdowns, [False])
        self.assertEqual(self.job.deleted, 0)
        self.assertEqual(ctx.floors, 1)
        request = self.job.refer_requests[0]
        self.assertEqual(request.participant_identity, "sip_1")
        self.assertEqual(request.ringing_timeout.seconds, 25)

    async def test_the_caller_is_asked_to_hold_not_told_they_are_connected(self):
        await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("stay on the line", self.session.replies[0])
        self.assertIn("Do not say they are connected", self.session.replies[0])

    async def test_a_named_department_goes_to_its_own_number(self):
        await self.agent.transfer_call(ctx_for(self.session), "caller_request", "billing")
        self.assertEqual(self.job.transfers, ["tel:+14385550002"])
        self.assertEqual(self.call.transfer["targetName"], "Billing")

    async def test_a_number_smuggled_in_as_department_is_never_dialed(self):
        await self.agent.transfer_call(ctx_for(self.session), "caller_request", "+19005551234")
        self.assertEqual(self.job.transfers, ["tel:+14389957350"])

    async def test_emergency_uses_the_emergency_line_after_hours_and_is_flagged(self):
        cfg = copy.deepcopy(CFG)
        cfg["afterHours"] = True
        self.make_agent(cfg)
        await self.agent.transfer_call(ctx_for(self.session), "emergency")
        self.assertEqual(self.job.transfers, ["tel:+14385550001"])
        self.assertTrue(self.call.emergency)

    async def test_a_normal_transfer_after_hours_is_refused_with_a_callback_offer(self):
        cfg = copy.deepcopy(CFG)
        cfg["afterHours"] = True
        self.make_agent(cfg)
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("closed", reply)
        self.assertEqual(self.job.transfers, [])
        self.assertIsNone(self.call.transfer)

    async def test_a_handoff_that_reports_failure_without_raising_is_not_a_success(self):
        # The original bug: the response was never read, so a contractor who did not
        # pick up still produced "completed: true" and a caller left in silence.
        self.job.transfer_response = refer_response("STS_TRANSFER_FAILED", "STR_RINGING_TIMEOUT")
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("did NOT connect", reply)
        self.assertIn("nobody answered", reply)
        self.assertEqual(self.call.transfer, {"targetName": "General line", "completed": False})
        self.assertNotEqual(self.call.payload().get("intent"), "transfer")
        self.assertEqual(self.session.shutdowns, [])
        self.assertFalse(self.agent._closing)
        self.assertFalse(self.agent._transferring)

    async def test_a_handoff_still_in_progress_is_not_a_success_either(self):
        self.job.transfer_response = refer_response("STS_TRANSFER_ONGOING", "STR_UNSPECIFIED")
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("did NOT connect", reply)
        self.assertFalse(self.call.transfer["completed"])

    async def test_a_busy_contractor_is_reported_as_busy(self):
        self.job.transfer_error = sip_call_error(486)
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("busy", reply)
        self.assertFalse(self.call.transfer["completed"])

    async def test_a_failed_transfer_can_be_retried_once_the_caller_asks_again(self):
        self.job.transfer_queue = [RuntimeError("trunk down")]
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("did NOT connect", reply)
        self.assertIn("callback", reply)
        self.assertEqual(self.call.transfer, {"targetName": "General line", "completed": False})
        self.assertFalse(self.agent._transferring)

        await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertTrue(self.call.transfer["completed"])

    async def test_an_emergency_tries_the_general_line_when_the_emergency_line_fails(self):
        self.job.transfer_queue = [refer_response("STS_TRANSFER_FAILED", "STR_REJECTED", sip=486)]
        reply = await self.agent.transfer_call(ctx_for(self.session), "emergency")
        self.assertEqual(self.job.transfers, ["tel:+14385550001", "tel:+14389957350"])
        self.assertIn("now connected", reply)
        self.assertEqual(self.call.transfer, {"targetName": "General line", "completed": True})

    async def test_a_second_transfer_while_one_runs_is_ignored(self):
        self.agent._transferring = True
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("already in progress", reply)
        self.assertEqual(self.job.transfers, [])


class FakeScreened:
    """Stands in for ScreenedTransfer. Awaiting it ends the way the script says.

    `script` has one entry per attempt: "connected", or the kind of failure.
    """

    script: list[str] = []
    made: list["FakeScreened"] = []
    hang = False

    def __init__(
        self, *, target, settings, language_name, emergency, facts, caller_id, business_name=""
    ):
        self.target = target
        self.business_name = business_name
        self.settings = settings
        self.language_name = language_name
        self.emergency = emergency
        self.facts = facts
        self.caller_id = caller_id
        cls = type(self)
        self.kind = cls.script.pop(0) if cls.script else "provider_error"
        self.created = time.monotonic()
        self.aborted = None
        self._done = False
        self._gate = asyncio.Event()
        cls.made.append(self)

    def done(self):
        return self._done

    def abort(self, kind="caller_left"):
        self.aborted = kind
        self._done = True
        self._gate.set()

    def __await__(self):
        return self._run().__await__()

    async def _run(self):
        if type(self).hang:
            await self._gate.wait()
        self._done = True
        if self.kind == "connected":
            return SimpleNamespace(human_agent_identity="human-agent-sip")
        if self.kind == "boom":
            raise RuntimeError("unexpected")
        raise ToolError("transfer failed")

    def outcome(self):
        if self.aborted:
            return A.TransferOutcome(False, TransferFailure(self.aborted), "warm")
        if self.kind == "connected":
            return A.TransferOutcome(True, mechanism="warm")
        return A.TransferOutcome(False, TransferFailure(self.kind), "warm")


class NeverFinishes:
    def __await__(self):
        return asyncio.Event().wait().__await__()


WARM = TransferSettings(
    mode="warm",
    trunk_id="ST_test123",
    caller_id="+14385550100",
    ring_seconds=25,
    consult_seconds=45,
    budget_seconds=100,
)


class WarmTransferFlowTests(FlowCase):
    """The screened warm transfer, with the LiveKit task replaced by a script."""

    transfers = WARM

    async def asyncSetUp(self):
        await super().asyncSetUp()
        FakeScreened.script, FakeScreened.made, FakeScreened.hang = [], [], False
        self._real_screened = A.ScreenedTransfer
        A.ScreenedTransfer = FakeScreened
        self._real_pause = A.BETWEEN_ATTEMPTS_SECONDS
        A.BETWEEN_ATTEMPTS_SECONDS = 0.0  # tests that care set their own

    async def asyncTearDown(self):
        A.ScreenedTransfer = self._real_screened
        A.BETWEEN_ATTEMPTS_SECONDS = self._real_pause
        await super().asyncTearDown()

    async def test_a_second_attempt_waits_for_the_first_side_room_to_be_released(self):
        A.BETWEEN_ATTEMPTS_SECONDS = 0.15
        FakeScreened.script = ["no_answer", "connected"]
        await self.agent.transfer_call(ctx_for(self.session), "emergency")
        first, second = FakeScreened.made
        self.assertGreaterEqual(second.created - first.created, 0.14)

    async def test_an_accepted_call_connects_and_the_agent_leaves_without_hanging_up(self):
        FakeScreened.script = ["connected"]
        ctx = ctx_for(self.session)
        reply = await self.agent.transfer_call(ctx, "caller_request")

        self.assertIn("now connected", reply)
        self.assertEqual(self.call.transfer, {"targetName": "General line", "completed": True})
        self.assertEqual(self.call.end_reason, "completed")
        self.assertEqual(self.session.shutdowns, [False])
        self.assertFalse(self.session.input.enabled)
        self.assertFalse(self.session.output.enabled)
        self.assertEqual(self.job.deleted, 0)  # deleting the room would drop both people
        self.assertEqual(self.job.transfers, [])  # no blind REFER in warm mode
        self.assertEqual(ctx.floors, 1)
        self.assertTrue(self.agent._keep_job_alive)

    async def test_the_process_stays_up_to_end_the_call_but_the_report_still_goes_out(self):
        FakeScreened.script = ["connected"]
        await self.agent.transfer_call(ctx_for(self.session), "emergency")
        self.agent._on_close(SimpleNamespace(reason=A.CloseReason.USER_INITIATED, error=None))
        await self.settle()

        self.assertEqual(len(self.client.reports), 1)
        report = self.client.reports[0]
        self.assertEqual(report["intent"], "transfer")
        self.assertEqual(report["transfer"], {"targetName": "Emergency", "completed": True})
        self.assertTrue(report["emergency"])
        self.assertEqual(self.job.shutdowns, [])  # job must outlive the model session
        self.assertEqual(self.job.deleted, 0)
        # LiveKit's own task installs the "either side left" hook (see test_warm_transfer);
        # a second one here would end the call twice.
        self.assertEqual(self.job.room.handlers.get("participant_disconnected", []), [])

    async def test_the_caller_is_asked_to_hold_before_the_phone_rings(self):
        FakeScreened.script = ["connected"]
        await self.agent.transfer_call(ctx_for(self.session), "emergency")
        self.assertIn("emergency contact", self.session.replies[0])
        self.assertIn("stay on the line", self.session.replies[0])

    async def test_what_the_caller_said_and_the_caller_id_reach_the_screening_call(self):
        self.call.update(caller_name="Marie Tremblay", address="12 rue Saint-Denis")
        FakeScreened.script = ["connected"]
        await self.agent.transfer_call(ctx_for(self.session), "emergency")
        made = FakeScreened.made[0]
        self.assertEqual(made.facts["callerName"], "Marie Tremblay")
        self.assertEqual(made.facts["serviceAddress"], "12 rue Saint-Denis")
        self.assertEqual(made.caller_id, "+14385550100")
        self.assertEqual(made.business_name, "")  # the test config carries no business name
        self.assertTrue(made.emergency)
        self.assertEqual(made.target.number, "+14385550001")

    async def test_without_a_configured_caller_id_the_business_line_is_shown(self):
        no_id = TransferSettings(mode="warm", trunk_id="ST_test123", caller_id=None)
        self.make_agent(transfers=no_id)
        FakeScreened.script = ["connected"]
        await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertEqual(FakeScreened.made[0].caller_id, "+14382314700")

    async def test_an_emergency_falls_back_to_the_general_line(self):
        FakeScreened.script = ["no_answer", "connected"]
        reply = await self.agent.transfer_call(ctx_for(self.session), "emergency")
        self.assertEqual(
            [m.target.number for m in FakeScreened.made], ["+14385550001", "+14389957350"]
        )
        self.assertIn("now connected", reply)
        self.assertEqual(self.call.transfer, {"targetName": "General line", "completed": True})

    async def test_nobody_reachable_returns_the_caller_to_the_agent_with_safety_advice(self):
        FakeScreened.script = ["no_answer", "busy"]
        reply = await self.agent.transfer_call(ctx_for(self.session), "emergency")

        self.assertIn("did NOT connect", reply)
        self.assertIn("911", reply)
        self.assertIn("alerted", reply)
        self.assertEqual(self.call.transfer, {"targetName": "General line", "completed": False})
        self.assertFalse(self.agent._transferring)
        self.assertFalse(self.agent._closing)
        self.assertFalse(self.agent._keep_job_alive)
        self.assertEqual(self.session.shutdowns, [])
        self.assertEqual(self.job.deleted, 0)
        # The owner is told through the normal report: an emergency whose transfer failed.
        payload = self.call.payload()
        self.assertTrue(payload["emergency"])
        self.assertEqual(payload["transfer"]["completed"], False)
        self.assertNotEqual(payload.get("intent"), "transfer")

    async def test_voicemail_is_not_a_transfer(self):
        FakeScreened.script = ["voicemail"]
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("voicemail", reply)
        self.assertIn("callback", reply)
        self.assertFalse(self.call.transfer["completed"])

    async def test_a_department_that_declines_falls_back_to_the_general_line(self):
        FakeScreened.script = ["declined", "connected"]
        await self.agent.transfer_call(ctx_for(self.session), "caller_request", "billing")
        self.assertEqual(
            [m.target.number for m in FakeScreened.made], ["+14385550002", "+14389957350"]
        )

    async def test_a_phone_system_failure_does_not_waste_the_callers_time_on_a_second_line(self):
        FakeScreened.script = ["provider_error", "connected"]
        reply = await self.agent.transfer_call(ctx_for(self.session), "emergency")
        self.assertEqual(len(FakeScreened.made), 1)
        self.assertIn("phone system", reply)
        self.assertFalse(self.call.transfer["completed"])

    async def test_a_wrong_number_is_skipped_for_the_next_line(self):
        FakeScreened.script = ["invalid_number", "connected"]
        await self.agent.transfer_call(ctx_for(self.session), "emergency")
        self.assertEqual(len(FakeScreened.made), 2)
        self.assertTrue(self.call.transfer["completed"])

    async def test_no_second_attempt_starts_when_the_time_budget_is_spent(self):
        tight = TransferSettings(
            mode="warm", trunk_id="ST_test123", ring_seconds=25, budget_seconds=20
        )
        self.make_agent(transfers=tight)
        FakeScreened.script = ["no_answer", "connected"]
        await self.agent.transfer_call(ctx_for(self.session), "emergency")
        self.assertEqual(len(FakeScreened.made), 1)
        self.assertFalse(self.call.transfer["completed"])

    async def test_an_unexpected_error_in_the_transfer_is_a_failure_not_a_crash(self):
        FakeScreened.script = ["boom"]
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("did NOT connect", reply)
        self.assertEqual(FakeScreened.made[0].aborted, "provider_error")
        self.assertFalse(self.agent._transferring)

    async def test_a_caller_who_hangs_up_while_the_phone_rings_drops_the_second_leg(self):
        FakeScreened.hang = True
        running = asyncio.create_task(
            self.agent.transfer_call(ctx_for(self.session), "emergency")
        )
        for _ in range(50):
            await asyncio.sleep(0.01)
            if FakeScreened.made:
                break
        self.assertTrue(FakeScreened.made)
        self.agent._on_close(
            SimpleNamespace(reason=A.CloseReason.PARTICIPANT_DISCONNECTED, error=None)
        )
        await asyncio.wait_for(running, 2)
        await self.settle()

        self.assertEqual(FakeScreened.made[0].aborted, "caller_left")
        self.assertEqual(len(self.client.reports), 1)
        self.assertEqual(self.client.reports[0]["transfer"]["completed"], False)
        self.assertEqual(self.client.reports[0]["endReason"], "caller_hung_up")
        self.assertEqual(self.job.shutdowns, ["call ended"])

    async def test_the_caller_cannot_keep_asking_forever(self):
        FakeScreened.script = ["no_answer", "no_answer"]
        await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertEqual(len(FakeScreened.made), 2)
        self.assertIn("Do not try to transfer again", reply)

    async def test_a_second_request_after_success_does_nothing(self):
        FakeScreened.script = ["connected"]
        await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("already connected", reply)
        self.assertEqual(len(FakeScreened.made), 1)

    async def test_a_hold_announcement_that_never_finishes_does_not_delay_the_ringing(self):
        A.HOLD_LINE_TIMEOUT_SECONDS, saved = 0.05, A.HOLD_LINE_TIMEOUT_SECONDS
        self.addCleanup(setattr, A, "HOLD_LINE_TIMEOUT_SECONDS", saved)
        self.session.handle_factory = NeverFinishes
        FakeScreened.script = ["connected"]
        reply = await asyncio.wait_for(
            self.agent.transfer_call(ctx_for(self.session), "caller_request"), 2
        )
        self.assertIn("now connected", reply)

    async def test_a_hold_announcement_that_raises_does_not_stop_the_transfer(self):
        def broken(**_):
            raise RuntimeError("tts down")

        self.session.generate_reply = broken
        FakeScreened.script = ["connected"]
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("now connected", reply)


class TransfersOffTests(FlowCase):
    transfers = TransferSettings(mode="off", problem="warm transfer needs a trunk")

    async def test_a_transfer_that_cannot_be_placed_says_so_instead_of_pretending(self):
        reply = await self.agent.transfer_call(ctx_for(self.session), "emergency")
        self.assertIn("did NOT connect", reply)
        self.assertIn("not available", reply)
        self.assertIn("911", reply)
        self.assertEqual(self.call.transfer, {"targetName": "Emergency", "completed": False})
        self.assertEqual(self.job.transfers, [])
        self.assertEqual(self.job.bridges, [])
        self.assertEqual(self.session.shutdowns, [])
        self.assertTrue(self.call.emergency)

    async def test_the_business_rule_for_after_hours_still_wins_over_the_configuration_message(self):
        cfg = copy.deepcopy(CFG)
        cfg["afterHours"] = True
        self.make_agent(cfg)
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertIn("closed", reply)
        self.assertIsNone(self.call.transfer)


class RecoveryTests(FlowCase):
    """The model session died: connect the caller to a person without the model."""

    def die(self):
        self.agent._on_close(
            SimpleNamespace(reason=A.CloseReason.ERROR, error=RuntimeError("model down"))
        )

    async def test_a_refer_that_reports_failure_ends_the_call_and_reports_it_honestly(self):
        self.job.transfer_response = refer_response("STS_TRANSFER_FAILED", "STR_RINGING_TIMEOUT")
        self.die()
        await self.settle()
        self.assertEqual(self.job.deleted, 1)
        report = self.client.reports[0]
        self.assertEqual(report["endReason"], "error")
        self.assertEqual(report["transfer"]["completed"], False)

    async def test_warm_mode_dials_the_contractor_straight_into_the_callers_room(self):
        self.make_agent(transfers=WARM)
        self.call.emergency = True
        self.die()
        await self.settle()

        self.assertEqual(self.job.transfers, [])
        request = self.job.bridges[0]
        self.assertEqual(request.sip_trunk_id, "ST_test123")
        self.assertEqual(request.sip_call_to, "+14385550001")  # the emergency line
        self.assertEqual(request.room_name, "call-room")
        self.assertTrue(request.wait_until_answered)
        self.assertEqual(request.sip_number, "+14385550100")
        self.assertEqual(request.ringing_timeout.seconds, 25)
        self.assertEqual(self.job.deleted, 0)
        self.assertEqual(self.job.shutdowns, [])  # stays to end the call when someone leaves
        self.assertTrue(self.client.reports[0]["transfer"]["completed"])
        # Dialed straight into the room, so nothing else will end the call: this does.
        (watcher,) = self.job.room.handlers["participant_disconnected"]
        watcher(SimpleNamespace(kind=W.rtc.ParticipantKind.PARTICIPANT_KIND_SIP))
        self.assertEqual(self.job.deleted_rooms, ["call-room"])

    async def test_warm_mode_with_nobody_answering_ends_the_call_and_says_so(self):
        self.make_agent(transfers=WARM)
        self.job.bridge_error = sip_call_error(480)
        self.die()
        await self.settle()
        self.assertEqual(self.job.deleted, 1)
        self.assertEqual(self.client.reports[0]["transfer"]["completed"], False)

    async def test_transfers_off_ends_the_call_instead_of_leaving_dead_air(self):
        self.make_agent(transfers=TransferSettings(mode="off"))
        self.die()
        await self.settle()
        self.assertEqual(self.job.deleted, 1)
        self.assertEqual(self.job.transfers, [])
        self.assertEqual(self.job.bridges, [])

    async def test_a_dead_model_during_a_transfer_drops_the_ringing_leg_first(self):
        self.make_agent(transfers=WARM)
        pending = FakeScreened.__new__(FakeScreened)
        pending.target = A.TransferTarget("+14385550001", "Emergency")
        pending.aborted = None
        pending._done = False
        pending._gate = asyncio.Event()
        pending.done = lambda: pending._done
        pending.abort = lambda kind="caller_left": setattr(pending, "aborted", kind)
        self.agent._active_transfer = pending
        self.die()
        await self.settle()
        self.assertEqual(pending.aborted, "caller_left")


class RoomWatcherTests(FlowCase):
    async def test_either_party_leaving_ends_the_call_but_an_agent_leaving_does_not(self):
        room = FakeRoom("bridged")
        W.delete_room_when_a_party_leaves(room)
        (watcher,) = room.handlers["participant_disconnected"]

        watcher(SimpleNamespace(kind=W.rtc.ParticipantKind.PARTICIPANT_KIND_AGENT))
        self.assertEqual(self.job.deleted_rooms, [])
        self.assertEqual(len(room.handlers["participant_disconnected"]), 1)

        watcher(SimpleNamespace(kind=W.rtc.ParticipantKind.PARTICIPANT_KIND_SIP))
        self.assertEqual(self.job.deleted_rooms, ["bridged"])
        self.assertEqual(room.handlers["participant_disconnected"], [])  # removed itself


class EndOfCallTests(FlowCase):
    async def test_report_is_sent_once_with_everything_that_happened(self):
        self.call.update(caller_name="Marie", reason="peinture")
        self.agent._on_item(SimpleNamespace(item=SimpleNamespace(type="message", role="user", text_content="Allo")))
        self.agent._on_item(SimpleNamespace(item=SimpleNamespace(type="message", role="assistant", text_content="Bonjour!")))
        self.agent._on_item(SimpleNamespace(item=SimpleNamespace(type="function_call", role=None, text_content=None)))
        await self.agent.finish()
        await self.agent.finish()
        self.assertEqual(len(self.client.reports), 1)
        report = self.client.reports[0]
        self.assertEqual(report["slots"]["callerName"], "Marie")
        self.assertEqual(
            report["transcript"],
            [{"speaker": "caller", "text": "Allo"}, {"speaker": "agent", "text": "Bonjour!"}],
        )
        self.assertEqual(report["endReason"], "caller_hung_up")

    async def test_a_caller_hanging_up_still_gets_reported_and_the_job_ends(self):
        self.call.update(reason="peinture")
        close = SimpleNamespace(reason=A.CloseReason.PARTICIPANT_DISCONNECTED, error=None)
        self.agent._on_close(close)
        await self.settle()
        self.assertEqual(len(self.client.reports), 1)
        self.assertEqual(self.client.reports[0]["endReason"], "caller_hung_up")
        self.assertEqual(self.job.shutdowns, ["call ended"])

    async def test_a_model_failure_hands_the_caller_to_a_person(self):
        close = SimpleNamespace(reason=A.CloseReason.ERROR, error=RuntimeError("model down"))
        self.agent._on_close(close)
        await self.settle()
        self.assertEqual(self.job.transfers, ["tel:+14389957350"])
        self.assertEqual(self.client.reports[0]["endReason"], "error")
        self.assertTrue(self.client.reports[0]["transfer"]["completed"])

    async def test_a_model_failure_after_hours_ends_the_call_instead_of_leaving_dead_air(self):
        cfg = copy.deepcopy(CFG)
        cfg["afterHours"] = True
        self.make_agent(cfg)
        close = SimpleNamespace(reason=A.CloseReason.ERROR, error=RuntimeError("model down"))
        self.agent._on_close(close)
        await self.settle()
        self.assertEqual(self.job.transfers, [])
        self.assertEqual(self.job.deleted, 1)
        self.assertEqual(len(self.client.reports), 1)

    async def test_no_client_means_no_crash_and_no_report(self):
        self.make_agent(client=None)
        await self.agent.finish()

    async def test_end_call_waits_for_the_goodbye_then_hangs_up(self):
        waited = []

        async def wait_for_playout():
            waited.append(True)

        reply = await self.agent.end_call(SimpleNamespace(wait_for_playout=wait_for_playout))
        self.assertEqual(reply, "Call ended.")
        self.assertEqual(waited, [True])
        self.assertEqual(self.job.deleted, 1)
        self.assertEqual(self.call.end_reason, "completed")

    async def test_end_call_refuses_while_something_is_in_progress(self):
        self.agent._busy = 1
        reply = await self.agent.end_call(SimpleNamespace(wait_for_playout=None))
        self.assertIn("still in progress", reply)
        self.assertEqual(self.job.deleted, 0)


if __name__ == "__main__":
    unittest.main()
