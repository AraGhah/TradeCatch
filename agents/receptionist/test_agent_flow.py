"""Call-flow tests for the voice agent, with a fake LiveKit session and fake TradeCatch.

They exercise the real ReceptionistAgent (language menu, silence, tools, report)
without a network. What they cannot show is how the realtime model *sounds* or
whether Twilio delivers the keypress: that needs a live call.
"""

import asyncio
import copy
import unittest
from types import SimpleNamespace

try:
    import agent as A
    from call_record import CallRecord
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


class FakeSession:
    def __init__(self):
        self.replies: list[str] = []
        self.interrupts = 0
        self.away_resets = 0

    def generate_reply(self, *, instructions, allow_interruptions=True, **_):
        self.replies.append(instructions)
        return FakeHandle()

    async def interrupt(self, force=False):
        self.interrupts += 1

    def reset_away_timer(self):
        self.away_resets += 1


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


class FakeJob:
    def __init__(self, transfer_error=None):
        self.deleted = 0
        self.transfers: list[str] = []
        self.shutdowns: list[str] = []
        self.room = SimpleNamespace(name="call-room")
        self.transfer_error = transfer_error

        async def transfer(request):
            if self.transfer_error:
                raise self.transfer_error
            self.transfers.append(request.transfer_to)

        self.api = SimpleNamespace(sip=SimpleNamespace(transfer_sip_participant=transfer))

    async def delete_room(self):
        self.deleted += 1

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

    async def asyncSetUp(self):
        self.client = FakeClient()
        self.job = FakeJob()
        self._patch = A.get_job_context
        A.get_job_context = lambda: self.job
        self.call = CallRecord(call_id="call-abc123", number="+14382314700", from_e164="+15145550142")
        self.make_agent()

    async def asyncTearDown(self):
        A.get_job_context = self._patch
        for task in list(self.agent._tasks):
            task.cancel()
        await asyncio.sleep(0)

    def make_agent(self, cfg=None, client="default"):
        self.agent = Harness(
            cfg=copy.deepcopy(self.cfg if cfg is None else cfg),
            call=self.call,
            client=self.client if client == "default" else client,
            sip_identity="sip_1",
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


class TransferTests(FlowCase):
    async def test_transfer_hands_the_call_to_the_configured_line(self):
        reply = await self.agent.transfer_call(SimpleNamespace(session=self.session), "caller_request")
        self.assertIn("transfer has started", reply)
        self.assertEqual(self.job.transfers, ["tel:+14389957350"])
        self.assertEqual(self.call.transfer, {"targetName": "General line", "completed": True})
        self.assertIn("connecting them now", self.session.replies[0])

    async def test_a_named_department_goes_to_its_own_number(self):
        await self.agent.transfer_call(SimpleNamespace(session=self.session), "caller_request", "billing")
        self.assertEqual(self.job.transfers, ["tel:+14385550002"])
        self.assertEqual(self.call.transfer["targetName"], "Billing")

    async def test_a_number_smuggled_in_as_department_is_never_dialed(self):
        await self.agent.transfer_call(SimpleNamespace(session=self.session), "caller_request", "+19005551234")
        self.assertEqual(self.job.transfers, ["tel:+14389957350"])

    async def test_emergency_uses_the_emergency_line_after_hours_and_is_flagged(self):
        cfg = copy.deepcopy(CFG)
        cfg["afterHours"] = True
        self.make_agent(cfg)
        await self.agent.transfer_call(SimpleNamespace(session=self.session), "emergency")
        self.assertEqual(self.job.transfers, ["tel:+14385550001"])
        self.assertTrue(self.call.emergency)

    async def test_a_normal_transfer_after_hours_is_refused_with_a_callback_offer(self):
        cfg = copy.deepcopy(CFG)
        cfg["afterHours"] = True
        self.make_agent(cfg)
        reply = await self.agent.transfer_call(SimpleNamespace(session=self.session), "caller_request")
        self.assertIn("closed", reply)
        self.assertEqual(self.job.transfers, [])
        self.assertIsNone(self.call.transfer)

    async def test_a_failed_transfer_is_reported_honestly_and_can_be_retried(self):
        self.job.transfer_error = RuntimeError("sip 486")
        reply = await self.agent.transfer_call(SimpleNamespace(session=self.session), "caller_request")
        self.assertIn("transfer failed", reply)
        self.assertIn("callback", reply)
        self.assertEqual(self.call.transfer, {"targetName": "General line", "completed": False})
        self.assertFalse(self.agent._transferring)
        self.assertNotEqual(self.call.payload().get("intent"), "transfer")

        self.job.transfer_error = None
        await self.agent.transfer_call(SimpleNamespace(session=self.session), "caller_request")
        self.assertTrue(self.call.transfer["completed"])

    async def test_a_second_transfer_while_one_runs_is_ignored(self):
        self.agent._transferring = True
        reply = await self.agent.transfer_call(SimpleNamespace(session=self.session), "caller_request")
        self.assertIn("already in progress", reply)
        self.assertEqual(self.job.transfers, [])


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
