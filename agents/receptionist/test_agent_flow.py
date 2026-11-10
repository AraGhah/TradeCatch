"""Call-flow tests for the voice agent, with a fake LiveKit session and fake TradeCatch.

They exercise the real ReceptionistAgent (language detection, silence, tools, report)
without a network. What they cannot show is how the realtime model *sounds* or
how well speech-to-text labels real callers' language: that needs a live call.
"""

import asyncio
import contextlib
import copy
import os
import time
import unittest
from types import SimpleNamespace

try:
    import agent as A
    import warm_transfer as W
    from call_record import CallRecord
    from language import Heard
    from livekit import api
    from livekit.agents.llm import RealtimeError, ToolError
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
        "detection": {
            "opening": [
                {"text": "Bonjour, ici Acme.", "lang": "fr"},
                {"text": "How can I help you?", "lang": "en"},
            ],
            "ask": [
                {"text": "Français ou anglais?", "lang": "fr"},
                {"text": "French or English?", "lang": "en"},
            ],
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

    # find / move / cancel / text, answered per action.
    appointment_calls: list[dict]
    appointment_results: dict

    async def appointments(self, body):
        if not hasattr(self, "appointment_calls"):
            self.appointment_calls = []
        self.appointment_calls.append(body)
        results = getattr(self, "appointment_results", None) or {
            "find": {
                "status": "found",
                "appointments": [
                    {
                        "appointmentId": "appt_1",
                        "label": "jeudi à 10 h",
                        "serviceName": "Débouchage",
                        "technicianName": "Marc",
                        "status": "confirmed",
                        "started": False,
                    }
                ],
            },
            "move": {"status": "moved", "label": "mardi à 9 h", "startAt": OFFERS[0]["startAt"]},
            "cancel": {"status": "canceled"},
            "text": {"status": "sent"},
        }
        return results.get(body.get("action"))

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

    def assertTransfer(self, actual, expected):
        """The transfer record has at least these fields, with these values."""
        self.assertIsNotNone(actual)
        self.assertEqual({k: actual.get(k) for k in expected}, expected)

    async def settle(self):
        """Let spawned tasks (timers, replies) run to completion."""
        for _ in range(5):
            await asyncio.sleep(0.05)
        pending = [t for t in self.agent._tasks if not t.done()]
        if pending:
            await asyncio.wait(pending, timeout=1)


def heard(language, words=6, confidence=0.9):
    return Heard(language, words, confidence)


class FakeListener:
    """Stands in for the speech-to-text language listener task."""

    def __init__(self):
        self.cancelled = False

    def cancel(self):
        self.cancelled = True


class OpeningAndLanguageTests(FlowCase):
    async def test_the_call_opens_in_french_and_english_at_once_with_no_menu(self):
        await self.agent.on_enter()
        await self.settle()
        self.assertEqual(len(self.session.replies), 1)
        opening = self.session.replies[0]
        self.assertLess(opening.index("Bonjour, ici Acme."), opening.index("How can I help you?"))
        self.assertIn('[Canadian French (Québec)] "Bonjour, ici Acme."', opening)
        self.assertIn('[North American English] "How can I help you?"', opening)
        for banned in ("press", "restez en ligne", "appuyez"):
            self.assertNotIn(banned, opening.lower())

    async def test_the_voice_model_starts_with_the_language_not_known_yet(self):
        self.assertIn("not known yet", self.agent.instructions)
        self.assertNotIn("The call is in Canadian French", self.agent.instructions)
        self.assertEqual(self.call.language, "fr")

    async def test_no_keypad_handler_is_attached(self):
        self.assertFalse(hasattr(self.agent, "_on_dtmf"))
        session = SimpleNamespace(on=lambda *a, **k: None)
        room = FakeRoom()
        self.agent.attach(session, SimpleNamespace(room=room))
        self.assertNotIn("sip_dtmf_received", room.handlers)

    async def test_an_english_caller_makes_the_call_english_without_a_second_greeting(self):
        await self.agent.on_enter()
        self.agent._on_heard(heard("en"))
        await self.settle()
        self.assertEqual(self.call.language, "en")
        self.assertIn("North American English", self.agent.instructions)
        self.assertEqual(len(self.session.replies), 1)

    async def test_a_french_caller_makes_the_call_french(self):
        await self.agent.on_enter()
        self.agent._on_heard(heard("fr-CA"))
        await self.settle()
        self.assertEqual(self.call.language, "fr")
        self.assertIn("Canadian French", self.agent.instructions)
        self.assertNotIn("not known yet", self.agent.instructions)
        self.assertEqual(len(self.session.replies), 1)

    async def test_a_one_word_hello_decides_nothing(self):
        await self.agent.on_enter()
        self.agent._on_heard(heard("en", words=1))
        await self.settle()
        self.assertIn("not known yet", self.agent.instructions)
        self.assertEqual(len(self.session.replies), 1)

    async def test_an_unclear_caller_is_asked_once_in_both_languages(self):
        await self.agent.on_enter()
        self.agent._on_heard(heard("es"))
        self.agent._on_heard(heard("es"))
        await self.settle()
        self.assertEqual(len(self.session.replies), 2)
        question = self.session.replies[1]
        self.assertLess(question.index("Français ou anglais?"), question.index("French or English?"))
        # Still talking in a language the line does not offer: it does not ask again.
        self.agent._on_heard(heard("es"))
        await self.settle()
        self.assertEqual(len(self.session.replies), 2)

    async def test_the_answer_to_the_question_decides_even_when_it_is_one_word(self):
        await self.agent.on_enter()
        self.agent._on_heard(heard("es"))
        self.agent._on_heard(heard("es"))
        await self.settle()
        self.agent._on_heard(heard("en", words=1))
        await self.settle()
        self.assertEqual(self.call.language, "en")
        self.assertIn("North American English", self.agent.instructions)
        self.assertEqual(len(self.session.replies), 2)

    async def test_no_usable_answer_keeps_the_start_language(self):
        await self.agent.on_enter()
        for _ in range(4):
            self.agent._on_heard(heard("es"))
        await self.settle()
        self.assertEqual(self.call.language, "fr")
        self.assertIn("Canadian French", self.agent.instructions)
        self.assertEqual(len(self.session.replies), 2)

    async def test_it_does_not_ask_again_when_the_model_already_asked(self):
        await self.agent.on_enter()
        self.agent._on_item(
            SimpleNamespace(
                item=SimpleNamespace(
                    type="message", role="assistant", text_content="Français ou anglais? French or English?"
                )
            )
        )
        self.agent._on_heard(heard("es"))
        self.agent._on_heard(heard("es"))
        await self.settle()
        self.assertEqual(len(self.session.replies), 1)

    async def test_a_borrowed_word_in_a_french_call_does_not_change_the_language(self):
        await self.agent.on_enter()
        self.agent._on_heard(heard("fr"))
        for _ in range(5):
            self.agent._on_heard(heard("en", words=1))
        self.agent._on_heard(heard("en", words=4))
        await self.settle()
        self.assertEqual(self.call.language, "fr")
        self.assertIn("Canadian French", self.agent.instructions)

    async def test_sustained_english_in_a_french_call_switches_it(self):
        await self.agent.on_enter()
        self.agent._on_heard(heard("fr"))
        self.agent._on_heard(heard("en", words=5))
        self.agent._on_heard(heard("en", words=5))
        await self.settle()
        self.assertEqual(self.call.language, "en")
        self.assertIn("North American English", self.agent.instructions)
        self.assertEqual(len(self.session.replies), 1)

    async def test_speech_heard_during_a_transfer_is_ignored(self):
        await self.agent.on_enter()
        self.agent._transferring = True
        self.agent._on_heard(heard("en"))
        await self.settle()
        self.assertEqual(self.call.language, "fr")
        self.assertIn("not known yet", self.agent.instructions)

    async def test_what_is_logged_has_a_language_and_a_size_but_never_words(self):
        with self.assertLogs("agent-tradecatch-receptionist", level="INFO") as logs:
            self.agent._on_heard(Heard("en", 6, 0.93))
            await self.settle()
        text = "\n".join(logs.output)
        self.assertIn("caller language heard: en (6 words, confidence 0.93)", text)
        self.assertIn("language decision: set en [clear_speech] after 1 utterances", text)

    async def test_the_caller_can_still_ask_out_loud_for_another_language(self):
        await self.agent.on_enter()
        await self.settle()
        reply = await self.agent.set_language(None, "en")
        self.assertIn("Switched", reply)
        self.assertEqual(self.call.language, "en")
        self.assertIn("North American English", self.agent.instructions)
        self.assertIn("Do not greet again", reply)
        self.assertNotIn("menu", reply.lower())
        # Asking for the same language again changes nothing.
        self.assertIn("already", (await self.agent.set_language(None, "en")).lower())

    async def test_a_spoken_request_is_not_overruled_by_one_or_two_sentences(self):
        await self.agent.on_enter()
        await self.agent.set_language(None, "en")
        self.agent._on_heard(heard("fr"))
        self.agent._on_heard(heard("fr"))
        await self.settle()
        self.assertEqual(self.call.language, "en")
        self.agent._on_heard(heard("fr"))
        await self.settle()
        self.assertEqual(self.call.language, "fr")

    async def test_a_language_the_line_does_not_offer_is_refused(self):
        cfg = copy.deepcopy(CFG)
        cfg["languageSelect"]["languages"] = ["fr"]
        self.make_agent(cfg)
        self.assertIn("not available", await self.agent.set_language(None, "en"))
        self.assertEqual(self.call.language, "fr")

    async def test_a_single_language_line_has_nothing_to_detect(self):
        cfg = copy.deepcopy(CFG)
        cfg["languageSelect"].update(startLanguage="en", languages=["en"])
        cfg["languageSelect"]["detection"] = {
            "opening": [
                {"text": "Hello, Acme.", "lang": "en"},
                {"text": "How can I help?", "lang": "en"},
            ],
            "ask": [],
        }
        self.make_agent(cfg)
        self.assertIn("The call is in North American English", self.agent.instructions)
        await self.agent.on_enter()
        await self.settle()
        self.assertEqual(len(self.session.replies), 1)
        self.assertIn("How can I help?", self.session.replies[0])
        calls = []
        original = A.start_listener
        A.start_listener = lambda **kw: calls.append(kw)
        try:
            self.agent.start_language_detection(SimpleNamespace(identity="sip_1"))
        finally:
            A.start_listener = original
        self.assertEqual(calls, [])

    async def test_an_older_server_without_language_settings_still_greets_in_both(self):
        self.make_agent({"instructions": "Base prompt.", "businessName": "Acme"})
        await self.agent.on_enter()
        self.assertIn("Bonjour, ici Lucie de Acme.", self.session.replies[0])
        self.assertIn("How can I help you?", self.session.replies[0])
        self.assertNotIn("press 1", self.session.replies[0])
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

    async def test_the_check_in_before_the_language_is_known_is_bilingual(self):
        await self.agent.on_enter()
        await self.agent._on_quiet()
        check_in = self.session.replies[-1]
        self.assertIn("Êtes-vous toujours là?", check_in)
        self.assertIn("Are you still there?", check_in)

    async def test_the_check_in_after_the_language_is_known_is_in_that_language_only(self):
        await self.agent.on_enter()
        self.agent._on_heard(heard("en"))
        await self.settle()
        await self.agent._on_quiet()
        check_in = self.session.replies[-1]
        self.assertIn("Are you still there?", check_in)
        self.assertNotIn("Êtes-vous", check_in)


class LanguageListenerWiringTests(FlowCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.started = []
        self.listener = FakeListener()
        self._start_listener = A.start_listener

        def fake_start(**kwargs):
            self.started.append(kwargs)
            return self.listener

        A.start_listener = fake_start

    async def asyncTearDown(self):
        A.start_listener = self._start_listener
        await super().asyncTearDown()

    async def test_the_listener_starts_for_the_caller_and_reports_to_the_agent(self):
        participant = SimpleNamespace(identity="sip_1")
        self.agent.start_language_detection(participant)
        self.assertEqual(len(self.started), 1)
        self.assertIs(self.started[0]["participant"], participant)
        self.assertEqual(self.started[0]["on_heard"], self.agent._on_heard)
        self.assertEqual(self.started[0]["on_failed"], self.agent._on_listener_failed)

    async def test_the_kill_switch_starts_no_listener_and_leaves_switching_to_the_model(self):
        original = os.environ.get("AGENT_LANGUAGE_DETECTION")
        os.environ["AGENT_LANGUAGE_DETECTION"] = "off"
        try:
            self.make_agent()
        finally:
            if original is None:
                os.environ.pop("AGENT_LANGUAGE_DETECTION")
            else:
                os.environ["AGENT_LANGUAGE_DETECTION"] = original
        self.agent.start_language_detection(SimpleNamespace(identity="sip_1"))
        self.assertEqual(self.started, [])
        self.assertIn("clearly talks to you in full sentences", self.agent.instructions)
        self.agent._on_heard(heard("en"))
        await self.settle()
        self.assertEqual(self.call.language, "fr")

    async def test_the_listener_stops_when_the_session_closes(self):
        self.agent.start_language_detection(SimpleNamespace(identity="sip_1"))
        self.agent._on_close(SimpleNamespace(reason=A.CloseReason.USER_INITIATED, error=None))
        self.assertTrue(self.listener.cancelled)

    async def test_when_the_listener_fails_the_call_keeps_going_in_its_language(self):
        await self.agent.on_enter()
        self.agent.start_language_detection(SimpleNamespace(identity="sip_1"))
        self.agent._on_listener_failed("stopped: ConnectionError")
        await self.settle()
        self.assertEqual(self.call.language, "fr")
        # The model is told to follow full sentences itself, and to ask when unsure.
        self.assertIn("clearly talks to you in full sentences", self.agent.instructions)
        self.assertEqual(len(self.session.replies), 1)
        # Later utterances (if any slip through) decide nothing.
        self.agent._on_heard(heard("en"))
        await self.settle()
        self.assertEqual(self.call.language, "fr")

    async def test_a_second_failure_report_changes_nothing(self):
        self.agent._on_listener_failed("a")
        self.agent._on_listener_failed("b")
        await self.settle()
        self.assertEqual(self.call.language, "fr")


class GptLiveHarness(Harness):
    """The agent on gpt-live, the production voice model, as LiveKit 1.8.10 drives it.

    Its starting instructions cannot change once the session runs (update_instructions
    raises), and a new system message in the chat context reaches the model as a
    standing rule (append_instructions). `rules` is everything the model was told to
    follow, oldest first.
    """

    def start_voice_model(self):
        self.fake_session.llm = SimpleNamespace(
            capabilities=SimpleNamespace(mutable_instructions=False)
        )
        self.rules = [self.instructions]

    async def update_instructions(self, instructions):
        raise RealtimeError(
            "gpt-live voice instructions are immutable after session start; use "
            "append_instructions for a standing rule"
        )

    async def update_chat_ctx(self, chat_ctx, **kwargs):
        known = {item.id for item in self.chat_ctx.items}
        for item in chat_ctx.items:
            if item.id not in known and getattr(item, "role", None) in ("system", "developer"):
                self.rules.append(item.text_content)
        await super().update_chat_ctx(chat_ctx, **kwargs)


class GptLiveLanguageTests(FlowCase):
    """Regression: a language change was logged, but gpt-live kept its first rule and answered in it."""

    def make_agent(self, cfg=None, client="default", transfers=None):
        self.agent = GptLiveHarness(
            cfg=copy.deepcopy(self.cfg if cfg is None else cfg),
            call=self.call,
            client=self.client if client == "default" else client,
            sip_identity="sip_1",
            transfers=transfers or self.transfers,
        )
        self.agent.fake_session = FakeSession()
        self.agent._ctx = self.job
        self.agent.start_voice_model()
        self.session = self.agent.fake_session
        return self.agent

    def assert_model_speaks_english_from_now_on(self, rules_before):
        # The caller's next questions get model replies with no per-reply instruction,
        # so the newest standing rule is what decides their language.
        self.assertEqual(len(self.agent.rules), rules_before + 1)
        rule = self.agent.rules[-1]
        self.assertIn("LANGUAGE UPDATE", rule)
        self.assertIn("speak only North American English", rule)
        self.assertIn("replaces the LANGUAGE OF THIS CALL section", rule)
        self.assertNotIn("Canadian French", rule)
        # The starting rule says a later update wins, so the two do not compete.
        self.assertIn("A later LANGUAGE UPDATE replaces this section.", self.agent.rules[0])

    async def test_the_starting_rule_follows_the_caller(self):
        self.assertIn("not known yet", self.agent.rules[0])
        self.assertIn("Reply in the language the caller speaks", self.agent.rules[0])

    async def test_an_english_caller_tells_the_voice_model_to_answer_in_english(self):
        await self.agent.on_enter()
        with self.assertNoLogs("agent-tradecatch-receptionist", level="ERROR"):
            self.agent._on_heard(heard("en"))
            await self.settle()
        self.assert_model_speaks_english_from_now_on(1)
        # Nothing else is spoken: the model already hears the caller and answers.
        self.assertEqual(len(self.session.replies), 1)
        self.assertEqual(self.call.language, "en")

    async def test_a_french_caller_also_gets_a_standing_rule(self):
        await self.agent.on_enter()
        self.agent._on_heard(heard("fr"))
        await self.settle()
        self.assertEqual(len(self.agent.rules), 2)
        self.assertIn("speak only Canadian French", self.agent.rules[-1])

    async def test_english_on_the_fallback_prompt_also_reaches_the_voice_model(self):
        self.agent = GptLiveHarness(cfg=None, call=self.call, client=None, sip_identity="sip_1")
        self.agent.fake_session = self.session
        self.agent.start_voice_model()
        self.assertIn("technical difficulties", self.agent.rules[0])
        await self.agent.on_enter()
        with self.assertNoLogs("agent-tradecatch-receptionist", level="ERROR"):
            self.agent._on_heard(heard("en"))
            await self.settle()
        self.assert_model_speaks_english_from_now_on(1)

    async def test_asking_out_loud_for_english_reaches_the_voice_model(self):
        await self.agent.on_enter()
        await self.settle()
        self.assertIn("Switched", await self.agent.set_language(None, "en"))
        self.assert_model_speaks_english_from_now_on(1)

    async def test_switching_back_to_french_adds_a_newer_french_rule(self):
        await self.agent.on_enter()
        self.agent._on_heard(heard("en"))
        await self.settle()
        await self.agent.set_language(None, "fr")
        self.assertIn("speak only Canadian French", self.agent.rules[-1])
        self.assertEqual(self.call.language, "fr")

    async def test_a_listener_failure_adds_one_rule_and_does_not_change_the_language(self):
        await self.agent.on_enter()
        with self.assertNoLogs("agent-tradecatch-receptionist", level="ERROR"):
            self.agent._on_listener_failed("stopped: TimeoutError")
            await self.settle()
        self.assertEqual(len(self.agent.rules), 2)
        self.assertIn("Automatic language detection is not available", self.agent.rules[-1])
        self.assertEqual(self.call.language, "fr")

    async def test_a_voice_model_that_refuses_the_rule_does_not_break_the_call_and_is_asked_again(self):
        accept = GptLiveHarness.update_chat_ctx

        async def refuse(chat_ctx, **kwargs):
            raise RealtimeError("refused")

        self.agent.update_chat_ctx = refuse
        await self.agent.on_enter()
        self.agent._on_heard(heard("en"))
        await self.settle()
        # The language is recorded for the report; the model still follows the caller on its own.
        self.assertEqual(self.call.language, "en")
        self.assertIsNone(self.agent._model_language)
        self.assertEqual(len(self.agent.rules), 1)
        # The model accepts rules again: the caller's next utterance delivers the one it missed.
        self.agent.update_chat_ctx = lambda chat_ctx, **kw: accept(self.agent, chat_ctx, **kw)
        self.agent._on_heard(heard("en"))
        await self.settle()
        self.assert_model_speaks_english_from_now_on(1)


class ReplyGapTests(FlowCase):
    def caller_stops(self):
        self.agent._on_user_state(state("speaking"))
        self.agent._on_user_state(SimpleNamespace(old_state="speaking", new_state="listening"))

    async def test_logs_how_long_the_caller_waits_for_an_answer(self):
        self.caller_stops()
        self.agent._on_metrics(
            SimpleNamespace(metrics=SimpleNamespace(type="llm_metrics", reasoning_tokens=40, completion_tokens=12))
        )
        with self.assertLogs("agent-tradecatch-receptionist", level="INFO") as logs:
            self.agent._on_agent_state(SimpleNamespace(old_state="thinking", new_state="speaking"))
        line = logs.output[-1]
        self.assertRegex(line, r"reply gap \d+\.\d\ds \(1 backend runs\)")

    async def test_agent_speech_without_a_caller_turn_logs_no_gap(self):
        with self.assertNoLogs("agent-tradecatch-receptionist", level="INFO"):
            self.agent._on_agent_state(SimpleNamespace(old_state="listening", new_state="speaking"))

    async def test_each_caller_turn_is_measured_once(self):
        self.caller_stops()
        self.agent._on_agent_state(SimpleNamespace(old_state="thinking", new_state="speaking"))
        with self.assertNoLogs("agent-tradecatch-receptionist", level="INFO"):
            self.agent._on_agent_state(SimpleNamespace(old_state="listening", new_state="speaking"))

    async def test_backend_runs_log_token_counts_only(self):
        with self.assertLogs("agent-tradecatch-receptionist", level="INFO") as logs:
            self.agent._on_metrics(
                SimpleNamespace(metrics=SimpleNamespace(type="llm_metrics", reasoning_tokens=40, completion_tokens=12))
            )
        self.assertIn("backend run: 40 reasoning tokens, 12 output tokens", logs.output[-1])

    async def test_the_gap_line_also_lists_the_stages_the_pipeline_reported(self):
        self.caller_stops()
        self.agent._on_metrics(
            SimpleNamespace(metrics=SimpleNamespace(type="llm_metrics", ttft=0.4, duration=0.9, reasoning_tokens=5, completion_tokens=3))
        )
        with self.assertLogs("agent-tradecatch-receptionist", level="INFO") as logs:
            self.agent._on_agent_state(SimpleNamespace(old_state="thinking", new_state="speaking"))
        self.assertRegex(
            logs.output[-1],
            r"reply gap \d+\.\d\ds \(1 backend runs\) \[model first token 0\.40s, model total 0\.90s\]",
        )

    async def test_the_end_of_the_call_logs_one_summary_of_every_turn(self):
        for _ in range(3):
            self.caller_stops()
            self.agent._on_agent_state(SimpleNamespace(old_state="thinking", new_state="speaking"))
        with self.assertLogs("agent-tradecatch-receptionist", level="INFO") as logs:
            self.agent._on_close(SimpleNamespace(reason=A.CloseReason.USER_INITIATED, error=None))
        summaries = [line for line in logs.output if "reply latency summary" in line]
        self.assertEqual(len(summaries), 1)
        self.assertRegex(summaries[0], r"reply latency summary: 3 turns, avg \d+\.\d\ds, p50 .*p95 .*max ")

    async def test_a_call_with_no_caller_turn_logs_no_summary(self):
        with self.assertNoLogs("agent-tradecatch-receptionist", level="INFO"):
            self.agent._stop_language_detection()
            self.assertIsNone(self.agent._latency.summary())


class PersonaInTheCallTests(FlowCase):
    async def test_an_unnamed_receptionist_is_lucie(self):
        self.assertIn("You are Lucie", self.agent.instructions)

    async def test_the_business_name_for_her_is_used_when_one_is_set(self):
        cfg = copy.deepcopy(CFG)
        cfg["receptionistName"] = "Sophie"
        self.make_agent(cfg)
        self.assertIn("You are Sophie", self.agent.instructions)
        self.assertNotIn("You are Lucie", self.agent.instructions)

    async def test_the_identity_rules_come_after_the_business_prompt(self):
        text = self.agent.instructions
        self.assertGreater(text.index("# YOUR IDENTITY AND VOICE"), text.index("Base prompt."))

    async def test_the_identity_rules_survive_a_language_change(self):
        text = self.agent._instructions_for("en")
        self.assertIn("You are Lucie", text)
        self.assertEqual(text.count("# YOUR IDENTITY AND VOICE"), 1)


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
        self.assertIn("unconfirmed", text)
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


class ExistingAppointmentTests(FlowCase):
    async def find(self, name="Hélène Tremblay"):
        return await self.agent.find_appointment(None, caller_name=name)

    async def test_find_needs_a_name_and_sends_the_carrier_caller_id_not_a_model_number(self):
        text = await self.agent.find_appointment(None)
        self.assertIn("Ask for the name", text)
        self.assertFalse(getattr(self.client, "appointment_calls", []))
        text = await self.find()
        self.assertIn("1. jeudi à 10 h, Débouchage, technician Marc", text)
        self.assertIn("never give an arrival estimate", text)
        body = self.client.appointment_calls[0]
        self.assertEqual(body["action"], "find")
        self.assertEqual(body["from"], "+15145550142")
        self.assertEqual(body["callerName"], "Hélène Tremblay")

    async def test_a_hidden_number_cannot_look_up_anything(self):
        self.call.from_e164 = None
        text = await self.find()
        self.assertIn("number is hidden", text)
        self.assertFalse(getattr(self.client, "appointment_calls", []))

    async def test_nothing_found_reveals_nothing(self):
        self.client.appointment_results = {"find": {"status": "not_found"}}
        text = await self.find()
        self.assertIn("Do NOT reveal anything about other bookings", text)
        self.assertEqual(self.call.appointments, [])

    async def test_moving_uses_new_times_for_that_appointment_and_only_says_moved_when_moved(self):
        await self.find()
        text = await self.agent.check_availability(None, preferred_time="mardi", existing_appointment=1)
        self.assertIn("call move_appointment with appointment 1", text)
        self.assertNotIn("call book_appointment", text)
        body = self.client.availability_calls[-1]
        self.assertEqual(body["appointmentId"], "appt_1")
        self.assertEqual(body["callerName"], "Hélène Tremblay")
        self.assertNotIn("serviceAddress", body)

        refused = await self.agent.book_appointment(None, 1)
        self.assertIn("for moving an existing appointment", refused)
        self.assertEqual(self.client.book_calls, [])

        text = await self.agent.move_appointment(None, 1, 1)
        self.assertTrue(text.startswith("MOVED."))
        move = self.client.appointment_calls[-1]
        self.assertEqual(move["action"], "move")
        self.assertEqual(move["startAt"], OFFERS[0]["startAt"])
        self.assertEqual(self.call.found(1).label, "mardi à 9 h")
        self.assertEqual(self.call.appointment_changes, [{"change": "moved", "label": "mardi à 9 h"}])
        self.assertEqual(self.call.payload().get("intent"), "appointment")

    async def test_move_needs_times_for_that_appointment_first(self):
        await self.find()
        await self.agent.check_availability(None)  # times for a NEW booking
        text = await self.agent.move_appointment(None, 1, 1)
        self.assertIn("Call check_availability", text)
        self.assertEqual([c["action"] for c in self.client.appointment_calls], ["find"])

    async def test_a_failed_move_is_never_reported_as_moved(self):
        await self.find()
        await self.agent.check_availability(None, existing_appointment=1)
        self.client.appointment_results = {"move": None}
        text = await self.agent.move_appointment(None, 1, 1)
        self.assertIn("NOT moved", text)
        self.assertEqual(self.call.appointment_changes, [])

    async def test_cancel_waits_for_a_clear_yes(self):
        await self.find()
        text = await self.agent.cancel_appointment(None, 1, caller_confirmed=False)
        self.assertIn("Not canceled", text)
        self.assertIn("jeudi à 10 h", text)
        self.assertNotIn("cancel", [c["action"] for c in self.client.appointment_calls])
        text = await self.agent.cancel_appointment(None, 1, caller_confirmed=True)
        self.assertTrue(text.startswith("CANCELED."))
        self.assertEqual(self.call.appointments, [])

    async def test_unknown_appointment_numbers_never_reach_the_server(self):
        for tool in (
            self.agent.move_appointment(None, 3, 1),
            self.agent.cancel_appointment(None, 3, caller_confirmed=True),
            self.agent.check_availability(None, existing_appointment=3),
        ):
            self.assertIn("not in the list", await tool)
        self.assertFalse(getattr(self.client, "appointment_calls", []))

    async def test_appointment_tools_are_off_without_phone_booking(self):
        cfg = copy.deepcopy(CFG)
        cfg["bookingEnabled"] = False
        self.make_agent(cfg)
        self.assertIn("cannot be looked up", await self.find())
        self.assertFalse(getattr(self.client, "appointment_calls", []))


class CallerTextTests(FlowCase):
    def texts_on(self):
        cfg = copy.deepcopy(CFG)
        cfg["callerTexts"] = True
        self.make_agent(cfg)

    async def test_texts_are_off_unless_the_business_has_an_sms_number(self):
        text = await self.agent.text_caller(None, "business_info")
        self.assertIn("not available", text)
        self.assertFalse(getattr(self.client, "appointment_calls", []))

    async def test_business_info_goes_to_the_caller_id_and_is_written_by_the_server(self):
        self.texts_on()
        text = await self.agent.text_caller(None, "business_info")
        self.assertTrue(text.startswith("SENT."))
        body = self.client.appointment_calls[0]
        self.assertEqual(body["action"], "text")
        self.assertEqual(body["kind"], "business_info")
        self.assertEqual(body["from"], "+15145550142")
        self.assertNotIn("body", body, "the model never supplies the words")

    async def test_an_appointment_text_needs_a_found_appointment(self):
        self.texts_on()
        self.assertIn("Call find_appointment first", await self.agent.text_caller(None, "appointment"))
        await self.agent.find_appointment(None, caller_name="Hélène")
        self.assertTrue((await self.agent.text_caller(None, "appointment", 1)).startswith("SENT."))
        self.assertEqual(self.client.appointment_calls[-1]["appointmentId"], "appt_1")

    async def test_opted_out_and_queued_texts_are_never_called_sent(self):
        self.texts_on()
        self.client.appointment_results = {"text": {"status": "opted_out"}}
        self.assertIn("opted out", await self.agent.text_caller(None, "business_info"))
        self.client.appointment_results = {"text": {"status": "queued"}}
        self.assertIn("do not say it was sent", await self.agent.text_caller(None, "business_info"))
        self.client.appointment_results = {"text": None}
        self.assertIn("could not be sent", await self.agent.text_caller(None, "business_info"))

    async def test_a_hidden_number_is_never_texted(self):
        self.texts_on()
        self.call.from_e164 = None
        self.assertIn("not available", await self.agent.text_caller(None, "business_info"))
        self.assertFalse(getattr(self.client, "appointment_calls", []))


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

    async def test_saving_a_request_says_what_is_still_to_ask(self):
        text = await self.agent.record_details(
            None, caller_name="Marie", callback_same_as_caller_id=True, service="plomberie"
        )
        self.assertTrue(text.startswith("Saved."))
        self.assertIn("Still to ask before you wrap up", text)
        self.assertIn("street address", text)
        self.assertIn("day and time", text)
        self.assertNotIn("the caller's name", text)  # already saved

    async def test_nothing_more_is_asked_once_the_request_is_complete(self):
        text = await self.agent.record_details(
            None,
            caller_name="Marie",
            callback_same_as_caller_id=True,
            address="12 rue des Pins, Laval",
            reason="Le chauffe-eau de la cave fuit depuis hier.",
            preferred_time="jeudi matin",
        )
        self.assertEqual(text, "Saved.")


class EndCallChecksTests(FlowCase):
    """The receptionist does not wave goodbye while the team still lacks what it needs."""

    async def hang_up(self):
        async def wait_for_playout():
            return None

        return await self.agent.end_call(SimpleNamespace(wait_for_playout=wait_for_playout))

    async def test_the_first_hang_up_is_refused_while_the_address_and_time_are_missing(self):
        await self.agent.record_details(
            None, caller_name="Marie", callback_same_as_caller_id=True,
            reason="Le chauffe-eau de la cave fuit depuis hier.",
        )
        reply = await self.hang_up()
        self.assertIn("Do not hang up yet", reply)
        self.assertIn("street address", reply)
        self.assertIn("day and time", reply)
        self.assertEqual(self.job.deleted, 0)
        self.assertFalse(self.agent._closing)

    async def test_a_caller_who_will_not_say_is_let_go_on_the_second_try(self):
        await self.agent.record_details(None, service="plomberie")
        self.assertIn("Do not hang up yet", await self.hang_up())
        self.assertEqual(await self.hang_up(), "Call ended.")
        self.assertEqual(self.job.deleted, 1)

    async def test_a_complete_request_hangs_up_at_once(self):
        await self.agent.record_details(
            None,
            caller_name="Marie",
            callback_same_as_caller_id=True,
            address="12 rue des Pins, Laval",
            reason="Le chauffe-eau de la cave fuit depuis hier.",
            preferred_time="jeudi matin",
        )
        self.assertEqual(await self.hang_up(), "Call ended.")

    async def test_a_conversation_with_nothing_saved_is_sent_back_to_record_it(self):
        for text in ("Bonjour", "J'ai une fuite", "Dans ma cave"):
            self.call.add_turn("caller", text)
        reply = await self.hang_up()
        self.assertIn("Nothing from this call is saved yet", reply)
        self.assertEqual(await self.hang_up(), "Call ended.")

    async def test_a_short_call_with_nothing_to_save_ends_normally(self):
        self.call.add_turn("caller", "Mauvais numéro")
        self.assertEqual(await self.hang_up(), "Call ended.")

    async def test_a_completed_transfer_is_never_held_up(self):
        await self.agent.record_details(None, service="plomberie")
        self.call.transfer = {"targetName": "Billing", "completed": True}
        self.assertEqual(await self.hang_up(), "Call ended.")


def ctx_for(session):
    return FakeContext(session)


class TransferTests(FlowCase):
    """The SIP REFER path (no outbound trunk): the result LiveKit reports is what counts."""

    async def test_a_completed_handoff_connects_the_call_and_the_agent_leaves(self):
        ctx = ctx_for(self.session)
        reply = await self.agent.transfer_call(ctx, "caller_request")
        self.assertIn("handed to the team's phone line", reply)  # a REFER never proves a person answered
        self.assertEqual(self.job.transfers, ["tel:+14389957350"])
        self.assertTransfer(self.call.transfer, {"targetName": "General line", "completed": True})
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
        self.assertTransfer(self.call.transfer, {"targetName": "General line", "completed": False})
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
        self.assertTransfer(self.call.transfer, {"targetName": "General line", "completed": False})
        self.assertFalse(self.agent._transferring)

        await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertTrue(self.call.transfer["completed"])

    async def test_an_emergency_tries_the_general_line_when_the_emergency_line_fails(self):
        self.job.transfer_queue = [refer_response("STS_TRANSFER_FAILED", "STR_REJECTED", sip=486)]
        reply = await self.agent.transfer_call(ctx_for(self.session), "emergency")
        self.assertEqual(self.job.transfers, ["tel:+14385550001", "tel:+14389957350"])
        self.assertIn("handed to the team's phone line", reply)  # a REFER never proves a person answered
        self.assertTransfer(self.call.transfer, {"targetName": "General line", "completed": True})

    async def test_a_refer_to_a_busy_operator_rolls_over_to_the_backup_line(self):
        self.make_agent(cfg={**CFG, "backupTransferE164": "+14385550003"})
        self.job.transfer_queue = [refer_response("STS_TRANSFER_FAILED", "STR_REJECTED", sip=486)]
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertEqual(self.job.transfers, ["tel:+14389957350", "tel:+14385550003"])
        self.assertIn("handed to the team's phone line", reply)  # a REFER never proves a person answered
        self.assertTransfer(self.call.transfer, {"targetName": "Backup line", "completed": True})

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
        self.assertTransfer(self.call.transfer, {"targetName": "General line", "completed": True})
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
        self.assertTransfer(report["transfer"], {"targetName": "Emergency", "completed": True})
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
        self.assertTransfer(self.call.transfer, {"targetName": "General line", "completed": True})

    async def test_nobody_reachable_returns_the_caller_to_the_agent_with_safety_advice(self):
        FakeScreened.script = ["no_answer", "busy"]
        reply = await self.agent.transfer_call(ctx_for(self.session), "emergency")

        self.assertIn("did NOT connect", reply)
        self.assertIn("911", reply)
        self.assertIn("alerted", reply)
        self.assertTransfer(self.call.transfer, {"targetName": "General line", "completed": False})
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

    async def test_an_unavailable_operator_rolls_over_to_the_owners_backup_line(self):
        self.make_agent(cfg={**CFG, "backupTransferE164": "+14385550003"})
        FakeScreened.script = ["no_answer", "connected"]
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertEqual(
            [m.target.number for m in FakeScreened.made], ["+14389957350", "+14385550003"]
        )
        self.assertIn("now connected", reply)
        self.assertTransfer(self.call.transfer, {"targetName": "Backup line", "completed": True})

    async def test_when_every_operator_is_unavailable_the_caller_is_offered_a_callback(self):
        self.make_agent(cfg={**CFG, "backupTransferE164": "+14385550003"})
        FakeScreened.script = ["busy", "declined"]
        reply = await self.agent.transfer_call(ctx_for(self.session), "caller_request")
        self.assertEqual(len(FakeScreened.made), 2)
        self.assertIn("did NOT connect", reply)
        self.assertIn("all the available lines", reply)
        self.assertIn("callback", reply)
        self.assertTransfer(self.call.transfer, {"targetName": "Backup line", "completed": False})
        self.assertFalse(self.agent._transferring)
        self.assertFalse(self.agent._keep_job_alive)

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
        self.assertEqual(self.call.transfer["targetName"], "Emergency")

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
        self.assertTransfer(self.call.transfer, {"targetName": "Emergency", "completed": False})
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
