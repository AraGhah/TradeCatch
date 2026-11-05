"""transfer_emergency: emergency priority, 911 advice and the fallback chain."""

import copy
import unittest

try:
    from test_agent_flow import CFG, FakeScreened, FlowCase, ctx_for, refer_response
    from transfer_testing import (
        EN_EMERGENCY,
        FR_EMERGENCY,
        FR_NORMAL,
        WarmCase,
        capture,
        event_fields,
        events,
    )
except ImportError as err:  # livekit-agents is not installed here
    raise unittest.SkipTest(f"livekit-agents unavailable: {err}")


class EmergencyReferTests(FlowCase):
    async def test_an_emergency_rings_the_emergency_line_first_and_flags_the_call(self):
        await self.agent.transfer_emergency(ctx_for(self.session))
        self.assertEqual(self.job.transfers, ["tel:+14385550001"])
        self.assertTrue(self.call.emergency)
        self.assertTransfer(self.call.transfer, {"targetName": "Emergency", "completed": True})

    async def test_the_french_emergency_announcement_is_used(self):
        await self.agent.transfer_emergency(ctx_for(self.session))
        self.assertIn(FR_EMERGENCY, self.session.replies[0])
        self.assertNotIn(FR_NORMAL, self.session.replies[0])

    async def test_the_english_emergency_announcement_is_used_in_english(self):
        await self.agent.set_language(None, "en")
        self.session.replies.clear()
        await self.agent.transfer_emergency(ctx_for(self.session))
        self.assertIn(EN_EMERGENCY, self.session.replies[0])

    async def test_without_an_emergency_line_the_general_line_is_used(self):
        cfg = copy.deepcopy(CFG)
        cfg.pop("emergencyTransferE164")
        self.make_agent(cfg)
        await self.agent.transfer_emergency(ctx_for(self.session))
        self.assertEqual(self.job.transfers, ["tel:+14389957350"])

    async def test_primary_fails_then_the_secondary_line_is_tried(self):
        self.job.transfer_queue = [refer_response("STS_TRANSFER_FAILED", "STR_RINGING_TIMEOUT")]
        with capture(self) as logs:
            await self.agent.transfer_emergency(ctx_for(self.session))
        self.assertEqual(self.job.transfers, ["tel:+14385550001", "tel:+14389957350"])
        self.assertIn("transfer_timeout", events(logs))
        started = event_fields(logs, "transfer_fallback_started")
        self.assertEqual(started[0]["next"], "General line")
        self.assertEqual(event_fields(logs, "transfer_fallback_completed")[0]["result"], "connected")

    async def test_a_911_saved_as_the_emergency_line_is_never_dialed(self):
        cfg = copy.deepcopy(CFG)
        cfg["emergencyTransferE164"] = "911"
        cfg.pop("transferE164")
        self.make_agent(cfg)
        reply = await self.agent.transfer_emergency(ctx_for(self.session))
        self.assertEqual(self.job.transfers, [])
        self.assertIn("911", reply)
        self.assertIn("urgent callback", reply)
        self.assertTrue(self.call.emergency)


class EmergencyFallbackChainTests(WarmCase):
    async def test_nobody_reachable_keeps_the_caller_and_asks_for_an_urgent_callback(self):
        FakeScreened.script = ["no_answer", "no_answer"]
        with capture(self) as logs:
            reply = await self.agent.transfer_emergency(ctx_for(self.session))
        self.assertIn("did NOT connect", reply)
        self.assertIn("911", reply)
        self.assertIn("call them back", reply)
        self.assertEqual([s.target.name for s in FakeScreened.made], ["Emergency", "General line"])
        # The caller is never hung up on.
        self.assertEqual(self.job.deleted, 0)
        self.assertEqual(self.session.shutdowns, [])
        self.assertTransfer(self.call.transfer, {"completed": False, "answerConfirmed": False})
        completed = event_fields(logs, "transfer_fallback_completed")
        self.assertEqual(completed[-1]["result"], "urgent_callback")

    async def test_the_report_carries_the_emergency_and_the_failed_transfer_for_the_alert(self):
        FakeScreened.script = ["busy", "busy"]
        await self.agent.transfer_emergency(ctx_for(self.session))
        await self.agent.finish()
        report = self.client.reports[0]
        self.assertTrue(report["emergency"])
        self.assertFalse(report["transfer"]["completed"])
        self.assertFalse(report["transfer"]["answerConfirmed"])

    async def test_after_hours_only_the_emergency_line_rings_then_an_urgent_callback(self):
        cfg = copy.deepcopy(CFG)
        cfg["afterHours"] = True
        self.make_agent(cfg)
        FakeScreened.script = ["no_answer"]
        reply = await self.agent.transfer_emergency(ctx_for(self.session))
        self.assertEqual([s.target.name for s in FakeScreened.made], ["Emergency"])
        self.assertIn("911", reply)

    async def test_the_screening_call_is_told_it_is_an_emergency(self):
        FakeScreened.script = ["connected"]
        await self.agent.transfer_emergency(ctx_for(self.session))
        self.assertTrue(FakeScreened.made[0].emergency)
        self.assertTransfer(self.call.transfer, {"completed": True, "answerConfirmed": True})


if __name__ == "__main__":
    unittest.main()
