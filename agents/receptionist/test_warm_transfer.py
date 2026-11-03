"""Tests for ScreenedTransfer, driven against LiveKit's real WarmTransferTask.

LiveKit's task is mocked only at its edges (the job context, the rooms and the SIP
API), so these tests prove that our overrides fit the parent class: the private
methods we hook still exist and still do what we rely on. They cannot show how the
contractor's phone sounds or what a carrier does with the call; that needs a live
call with a real outbound trunk.
"""

import asyncio
import importlib
import unittest
from types import SimpleNamespace

try:
    import warm_transfer as W
    from livekit import api
    from routing import TransferTarget
    from transfer import TransferFailure, TransferSettings
except ImportError as err:  # livekit-agents is not installed here
    raise unittest.SkipTest(f"livekit-agents unavailable: {err}")

# The module that defines WarmTransferTask looks up its own get_job_context.
PARENT = importlib.import_module("livekit.agents.beta.workflows.warm_transfer")

TARGET = TransferTarget("+14385550001", "Emergency")
SETTINGS = TransferSettings(
    mode="warm",
    trunk_id="ST_test123",
    caller_id="+14385550100",
    ring_seconds=25,
    consult_seconds=45,
    budget_seconds=100,
)


def sip_error(code):
    return api.SipCallError(
        "unavailable", "call failed", status=503, metadata={"sip_status_code": str(code)}
    )


class FakeRoom:
    def __init__(self, name):
        self.name = name
        self.handlers = {}

    def on(self, event, handler):
        self.handlers.setdefault(event, []).append(handler)

    def off(self, event, handler):
        if handler in self.handlers.get(event, []):
            self.handlers[event].remove(handler)

    def emit(self, event, *args):
        for handler in list(self.handlers.get(event, [])):
            handler(*args)


class FakeJob:
    def __init__(self):
        self.room = FakeRoom("call-room")
        self.sip_requests = []
        self.sip_error = None
        self.sip_hangs = False
        self.moves = []
        self.move_error = None
        self.move_delay = 0.0
        self.deleted_rooms = []

        async def create_sip_participant(request):
            self.sip_requests.append(request)
            if self.sip_hangs:
                await asyncio.Event().wait()
            if self.sip_error:
                raise self.sip_error

        async def move_participant(request):
            self.moves.append(request)
            if self.move_delay:
                await asyncio.sleep(self.move_delay)
            if self.move_error:
                raise self.move_error

        self.api = SimpleNamespace(
            sip=SimpleNamespace(create_sip_participant=create_sip_participant),
            room=SimpleNamespace(move_participant=move_participant),
        )

    def delete_room(self, room_name=None):
        self.deleted_rooms.append(room_name)


class ScreenedCase(unittest.IsolatedAsyncioTestCase):
    settings = SETTINGS

    async def asyncSetUp(self):
        self.job = FakeJob()
        self._saved = (PARENT.get_job_context, W.get_job_context, W.REPORT_GRACE_SECONDS, W.SETUP_GRACE_SECONDS)
        PARENT.get_job_context = lambda: self.job
        W.get_job_context = lambda: self.job
        self.task = self.make_task()

    async def asyncTearDown(self):
        PARENT.get_job_context, W.get_job_context, W.REPORT_GRACE_SECONDS, W.SETUP_GRACE_SECONDS = self._saved
        self.task._disarm()
        for background in list(self.task._background):
            background.cancel()
        await asyncio.sleep(0)

    def make_task(self, settings=None):
        task = W.ScreenedTransfer(
            target=TARGET,
            settings=settings or self.settings,
            language_name="Canadian French (Québec)",
            emergency=True,
            facts={"callerName": "Marie Tremblay", "serviceAddress": "12 rue Saint-Denis"},
            caller_id="+14385550100",
        )
        # No session in these tests: record the caller's audio switching instead.
        task.io_calls = []
        task._set_io_enabled = lambda enabled: task.io_calls.append(enabled)
        task._caller_room = self.job.room
        self.consult_room = FakeRoom("call-room-human-agent")
        task.session_shutdowns = 0

        def shutdown():
            task.session_shutdowns += 1

        task._human_agent_sess = SimpleNamespace(
            room_io=SimpleNamespace(room=self.consult_room), shutdown=shutdown
        )
        return task

    async def originate(self):
        await self.task._originate_human_agent(
            room_name="call-room-human-agent", identity="human-agent-sip", room=self.consult_room
        )

    def key(self, digit, identity="human-agent-sip"):
        self.consult_room.emit(
            "sip_dtmf_received",
            SimpleNamespace(digit=digit, participant=SimpleNamespace(identity=identity)),
        )

    async def settle(self):
        for _ in range(5):
            await asyncio.sleep(0.01)
        if self.task._background:
            await asyncio.wait(set(self.task._background), timeout=1)


class DialingTests(ScreenedCase):
    async def test_the_call_is_placed_on_the_configured_trunk_for_the_chosen_line(self):
        await self.originate()
        request = self.job.sip_requests[0]
        self.assertEqual(request.sip_trunk_id, "ST_test123")
        self.assertEqual(request.sip_call_to, "+14385550001")
        self.assertEqual(request.sip_number, "+14385550100")
        self.assertEqual(request.room_name, "call-room-human-agent")
        self.assertTrue(request.wait_until_answered)
        self.assertEqual(request.ringing_timeout.seconds, 25)
        self.assertIsNone(self.task.failure)

    async def test_the_screening_assistant_gets_the_caller_details_and_the_language(self):
        text = self.task.instructions
        self.assertIn("EMERGENCY", text)
        self.assertIn("Marie Tremblay", text)
        self.assertIn("12 rue Saint-Denis", text)
        self.assertIn("Canadian French", text)
        self.assertIn("press 1", text)
        self.assertIn("connect_to_caller", text)

    async def test_sip_failures_are_recorded_with_their_cause(self):
        cases = {
            486: "busy",
            600: "busy",
            603: "declined",
            480: "no_answer",
            408: "no_answer",
            487: "no_answer",
            404: "invalid_number",
            484: "invalid_number",
            403: "provider_error",  # e.g. Twilio geographic permission
            503: "provider_error",
        }
        for code, kind in cases.items():
            with self.subTest(code=code):
                task = self.make_task()
                self.task = task
                self.job.sip_error = sip_error(code)
                with self.assertRaises(api.SipCallError):
                    await task._originate_human_agent(
                        room_name="r", identity="human-agent-sip", room=self.consult_room
                    )
                self.assertEqual(task.failure, TransferFailure(kind, code))

    async def test_any_other_error_is_a_provider_error(self):
        self.job.sip_error = ConnectionError("network")
        with self.assertRaises(ConnectionError):
            await self.originate()
        self.assertEqual(self.task.failure.kind, "provider_error")

    async def test_a_sip_request_that_never_returns_is_cut_off_as_no_answer(self):
        W.REPORT_GRACE_SECONDS = 0.05
        self.task = self.make_task(
            TransferSettings(mode="warm", trunk_id="ST_test123", ring_seconds=0.05)
        )
        self.job.sip_hangs = True
        with self.assertRaises(asyncio.TimeoutError):
            await self.originate()
        self.assertEqual(self.task.failure.kind, "no_answer")

    async def test_answering_starts_the_deadline_for_a_yes(self):
        await self.originate()
        self.assertIsNotNone(self.task._timer)
        self.assertFalse(self.task.done())


class AcceptingTests(ScreenedCase):
    async def test_pressing_1_connects_the_call(self):
        await self.originate()
        self.key("1")
        await self.settle()
        self.assertTrue(self.task.connected)
        self.assertTrue(self.task.done())
        self.assertIsNone(self.task.failure)
        self.assertEqual(len(self.job.moves), 1)
        self.assertEqual(self.job.moves[0].destination_room, "call-room")
        self.assertEqual(self.job.moves[0].identity, "human-agent-sip")
        self.assertTrue(self.task.outcome().connected)

    async def test_after_connecting_the_model_is_muted_not_left_listening(self):
        await self.originate()
        self.key("1")
        await self.settle()
        # LiveKit switches the caller's audio back on for the model; we switch it off again.
        self.assertEqual(self.task.io_calls, [True, False])

    async def test_after_connecting_either_party_leaving_ends_the_call(self):
        await self.originate()
        self.key("1")
        await self.settle()
        self.job.room.emit(
            "participant_disconnected",
            SimpleNamespace(kind=PARENT.DEFAULT_PARTICIPANT_KINDS[1], identity="caller"),
        )
        self.assertEqual(self.job.deleted_rooms, ["call-room"])

    async def test_other_keys_and_other_people_do_not_connect(self):
        await self.originate()
        self.key("2")
        self.key("5")
        self.key("1", identity="someone-else")
        await self.settle()
        self.assertFalse(self.task.done())
        self.assertEqual(self.job.moves, [])

    async def test_pressing_1_twice_connects_once(self):
        await self.originate()
        self.key("1")
        self.key("1")
        await self.settle()
        self.assertEqual(len(self.job.moves), 1)

    async def test_saying_yes_and_pressing_1_at_the_same_moment_connect_once(self):
        await self.originate()
        self.job.move_delay = 0.05  # the two accepts overlap while the first is merging
        results = await asyncio.gather(
            self.task.connect_to_caller(),
            self.task.connect_to_caller(),
            return_exceptions=True,
        )
        await self.settle()
        self.assertEqual(results, [None, None])  # neither accept blew up on the other
        self.assertEqual(len(self.job.moves), 1)
        self.assertTrue(self.task.connected)

    async def test_a_late_keypress_after_the_attempt_ended_does_nothing(self):
        await self.originate()
        self.task.abort("caller_left")
        self.key("1")
        await self.settle()
        self.assertEqual(self.job.moves, [])
        self.assertFalse(self.task.connected)

    async def test_if_the_calls_cannot_be_merged_the_caller_gets_the_agent_back(self):
        await self.originate()
        self.job.move_error = RuntimeError("room api down")
        self.key("1")
        await self.settle()
        self.assertTrue(self.task.done())
        self.assertFalse(self.task.connected)
        self.assertEqual(self.task.failure.kind, "provider_error")
        self.assertEqual(self.task.session_shutdowns, 1)  # the second leg is dropped


class RefusalTests(ScreenedCase):
    async def test_a_contractor_who_declines_returns_the_caller(self):
        await self.originate()
        await self.task.decline_transfer(reason="on another job")
        self.assertTrue(self.task.done())
        self.assertEqual(self.task.failure.kind, "declined")
        self.assertFalse(self.task.outcome().connected)
        self.assertEqual(self.job.moves, [])

    async def test_voicemail_is_a_failure_even_though_the_sip_call_was_answered(self):
        await self.originate()
        await self.task.voicemail_detected()
        self.assertTrue(self.task.done())
        self.assertEqual(self.task.failure.kind, "voicemail")
        self.assertEqual(self.job.moves, [])

    async def test_a_contractor_who_hangs_up_during_screening_returns_the_caller(self):
        await self.originate()
        self.task._on_human_agent_room_close(0)
        self.assertTrue(self.task.done())
        self.assertEqual(self.task.failure.kind, "hung_up")

    async def test_the_caller_hanging_up_drops_the_second_leg(self):
        await self.originate()
        self.task.abort("caller_left")
        self.assertTrue(self.task.done())
        self.assertEqual(self.task.failure.kind, "caller_left")
        self.assertEqual(self.task.session_shutdowns, 1)

    async def test_aborting_twice_is_harmless(self):
        await self.originate()
        self.task.abort("caller_left")
        self.task.abort("provider_error")
        self.assertEqual(self.task.failure.kind, "caller_left")


class DeadlineTests(ScreenedCase):
    async def test_nobody_saying_yes_in_time_returns_the_caller(self):
        self.task = self.make_task(
            TransferSettings(mode="warm", trunk_id="ST_test123", consult_seconds=0.05)
        )
        await self.originate()
        await asyncio.sleep(0.2)
        self.assertTrue(self.task.done())
        self.assertEqual(self.task.failure.kind, "no_confirmation")
        self.assertFalse(self.task.connected)
        self.assertEqual(self.task.session_shutdowns, 1)

    async def test_a_deadline_never_cuts_off_a_merge_that_is_under_way(self):
        await self.originate()
        self.task._merging = True
        self.task._expire("no_confirmation")
        self.assertFalse(self.task.done())

    async def test_a_dial_that_never_returns_is_cut_off_at_the_deadline(self):
        W.SETUP_GRACE_SECONDS = 0.05
        self.task = self.make_task(
            TransferSettings(mode="warm", trunk_id="ST_test123", ring_seconds=0.05)
        )
        self.task._hold_audio = None  # no background audio in this test
        self.task._set_io_enabled = lambda enabled: None

        async def never():
            await asyncio.sleep(3600)

        self.task._dial_human_agent = never
        await asyncio.wait_for(self.task.on_enter(), 2)
        self.assertTrue(self.task.done())
        self.assertEqual(self.task.failure.kind, "timeout")

    async def test_a_failed_dial_keeps_its_real_cause(self):
        self.task._hold_audio = None
        failure = TransferFailure("busy", 486)

        async def busy():
            self.task.failure = failure
            raise api.SipCallError("unavailable", "busy", status=503, metadata={})

        self.task._dial_human_agent = busy
        await asyncio.wait_for(self.task.on_enter(), 2)
        self.assertTrue(self.task.done())
        self.assertEqual(self.task.failure, failure)


class FallbackHelperTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.job = FakeJob()
        self._saved = W.get_job_context
        W.get_job_context = lambda: self.job

    async def asyncTearDown(self):
        W.get_job_context = self._saved

    def refer(self, status, reason, sip=None):
        response = api.TransferSIPParticipantResponse(
            status=api.SIPTransferStatus.Value(status), reason=api.SIPTransferReason.Value(reason)
        )
        if sip:
            response.sip_status.code = sip

        async def transfer(request):
            return response

        self.job.api.sip.transfer_sip_participant = transfer

    async def run_refer(self):
        return await W.refer_transfer(
            identity="sip_1", number="+14385550001", settings=SETTINGS
        )

    async def test_refer_success_requires_the_successful_status(self):
        self.refer("STS_TRANSFER_SUCCESSFUL", "STR_COMPLETED")
        self.assertTrue((await self.run_refer()).connected)

    async def test_refer_failures_keep_the_reason(self):
        cases = [
            (("STS_TRANSFER_FAILED", "STR_RINGING_TIMEOUT", None), "no_answer"),
            (("STS_TRANSFER_FAILED", "STR_REJECTED", None), "declined"),
            (("STS_TRANSFER_FAILED", "STR_REJECTED", 486), "busy"),
            (("STS_TRANSFER_FAILED", "STR_CALL_ENDED", None), "caller_left"),
            (("STS_TRANSFER_FAILED", "STR_UNSPECIFIED", None), "provider_error"),
            (("STS_TRANSFER_ONGOING", "STR_UNSPECIFIED", None), "provider_error"),
        ]
        for args, kind in cases:
            with self.subTest(args=args):
                self.refer(*args)
                outcome = await self.run_refer()
                self.assertFalse(outcome.connected)
                self.assertEqual(outcome.failure.kind, kind)

    async def test_refer_errors_are_failures_not_exceptions(self):
        async def boom(request):
            raise sip_error(486)

        self.job.api.sip.transfer_sip_participant = boom
        outcome = await self.run_refer()
        self.assertEqual(outcome.failure, TransferFailure("busy", 486))

        async def other(request):
            raise RuntimeError("x")

        self.job.api.sip.transfer_sip_participant = other
        self.assertEqual((await self.run_refer()).failure.kind, "provider_error")

    async def test_the_direct_bridge_reports_what_happened(self):
        ok = await W.bridge_without_screening(
            number="+14385550001", caller_id="+14385550100", settings=SETTINGS
        )
        self.assertTrue(ok.connected)

        self.job.sip_error = sip_error(486)
        busy = await W.bridge_without_screening(
            number="+14385550001", caller_id=None, settings=SETTINGS
        )
        self.assertEqual(busy.failure.kind, "busy")
        self.assertIsNone(self.job.sip_requests[-1].sip_number or None)


if __name__ == "__main__":
    unittest.main()
