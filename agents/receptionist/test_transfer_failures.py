"""Transfer failures: the caller is never dropped, and nothing is claimed that did not happen."""

import asyncio
import copy
import unittest
from types import SimpleNamespace

try:
    import agent as A
    from test_agent_flow import CFG, FakeScreened, FlowCase, ctx_for, refer_response, sip_call_error
    from transfer_testing import WarmCase, capture, event_fields, events
except ImportError as err:  # livekit-agents is not installed here
    raise unittest.SkipTest(f"livekit-agents unavailable: {err}")


def assert_caller_kept(case):
    case.assertEqual(case.job.deleted, 0, "the call must not be ended")
    case.assertEqual(case.session.shutdowns, [], "the agent must stay with the caller")
    case.assertFalse(case.agent._transferring)


class MissingParticipantTests(FlowCase):
    async def test_no_sip_participant_identity_means_no_transfer(self):
        self.agent._sip_identity = None
        reply = await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn("unavailable", reply)
        self.assertEqual(self.job.transfers, [])

    async def test_a_caller_who_already_left_the_room_is_not_transferred(self):
        self.job.room.remote_participants = {}
        with capture(self) as logs:
            reply = await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn("already left", reply)
        self.assertEqual(self.job.transfers, [])
        self.assertEqual(event_fields(logs, "transfer_failed")[0]["failure"], "caller_left")

    async def test_a_caller_still_in_the_room_is_transferred(self):
        self.job.room.remote_participants = {"sip_1": object()}
        await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertEqual(self.job.transfers, ["tel:+14389957350"])


class ReferFailureTests(FlowCase):
    async def test_a_rejected_refer_keeps_the_caller_and_offers_a_callback(self):
        self.job.transfer_response = refer_response("STS_TRANSFER_FAILED", "STR_REJECTED")
        with capture(self) as logs:
            reply = await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn("did NOT connect", reply)
        self.assertIn("call them back", reply)
        assert_caller_kept(self)
        self.assertTransfer(self.call.transfer, {"completed": False, "answerConfirmed": False})
        self.assertIn("transfer_failed", events(logs))
        self.assertEqual(
            event_fields(logs, "transfer_fallback_completed")[-1]["result"], "callback_offered"
        )

    async def test_a_refer_the_provider_refuses_stops_at_once_and_keeps_the_caller(self):
        # 403 from Twilio: REFER not enabled on the trunk. Another number fails the same way.
        self.job.transfer_error = sip_call_error(403)
        reply = await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn("could not place the call", reply)
        assert_caller_kept(self)

    async def test_no_answer_falls_back_to_the_next_line(self):
        cfg = copy.deepcopy(CFG)
        cfg["backupTransferE164"] = "+14385550003"
        self.make_agent(cfg)
        self.job.transfer_queue = [refer_response("STS_TRANSFER_FAILED", "STR_RINGING_TIMEOUT")]
        with capture(self) as logs:
            await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertEqual(self.job.transfers, ["tel:+14389957350", "tel:+14385550003"])
        names = events(logs)
        self.assertLess(names.index("transfer_timeout"), names.index("transfer_fallback_started"))
        self.assertIn("transfer_accepted", names)

    async def test_an_accepted_refer_is_not_a_confirmed_human_answer(self):
        await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertTransfer(
            self.call.transfer,
            {"completed": True, "answerConfirmed": False, "mechanism": "blind"},
        )
        await self.agent.finish()
        sent = self.client.reports[0]["transfer"]
        self.assertTrue(sent["completed"])
        self.assertFalse(sent["answerConfirmed"])
        self.assertEqual(sent["mechanism"], "blind")

    async def test_the_caller_can_ask_again_once_then_gets_a_callback(self):
        self.job.transfer_response = refer_response("STS_TRANSFER_FAILED", "STR_REJECTED")
        await self.agent.transfer_to_human(ctx_for(self.session))
        second = await self.agent.transfer_to_human(ctx_for(self.session))
        third = await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn("offer a callback", second)
        self.assertIn("Do not try to transfer again", third)
        assert_caller_kept(self)


class WarmFailureTests(WarmCase):
    async def test_voicemail_is_a_failure_not_an_answer(self):
        FakeScreened.script = ["voicemail", "voicemail"]
        reply = await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn("voicemail", reply)
        assert_caller_kept(self)
        self.assertFalse(self.call.transfer["answerConfirmed"])

    async def test_an_unexpected_error_keeps_the_caller(self):
        FakeScreened.script = ["boom"]
        reply = await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn("did NOT connect", reply)
        assert_caller_kept(self)

    async def test_a_caller_who_hangs_up_while_ringing_ends_the_second_leg(self):
        FakeScreened.hang = True
        with capture(self) as logs:
            pending = asyncio.create_task(self.agent.transfer_to_human(ctx_for(self.session)))
            for _ in range(20):
                await asyncio.sleep(0.01)
                if FakeScreened.made:
                    break
            self.agent._on_close(
                SimpleNamespace(reason=A.CloseReason.PARTICIPANT_DISCONNECTED, error=None)
            )
            await asyncio.wait_for(pending, 2)
            await self.settle()
        self.assertEqual(FakeScreened.made[0].aborted, "caller_left")
        self.assertEqual(len(FakeScreened.made), 1, "no further line rings for a caller who left")
        report = self.client.reports[0]
        self.assertFalse(report["transfer"]["completed"])
        self.assertEqual(report["endReason"], "caller_hung_up")
        self.assertIn("caller_left", [f["failure"] for f in event_fields(logs, "transfer_failed")])
        self.assertNotIn("transfer_fallback_completed", events(logs))


if __name__ == "__main__":
    unittest.main()
