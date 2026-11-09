"""transfer_to_human: a caller asks for a person."""

import copy
import unittest

try:
    import agent as A
    from livekit.agents import llm
    from test_agent_flow import CFG, FakeScreened, ctx_for
    from transfer_testing import (
        EN_NORMAL,
        FR_NORMAL,
        WarmCase,
        capture,
        event_fields,
        events,
    )
    from test_agent_flow import FlowCase
except ImportError as err:  # livekit-agents is not installed here
    raise unittest.SkipTest(f"livekit-agents unavailable: {err}")


class ToolSurfaceTests(unittest.TestCase):
    def test_the_model_gets_exactly_two_transfer_tools_and_neither_takes_a_number(self):
        tools = {t.info.name: t for t in llm.find_function_tools(A.ReceptionistAgent)}
        self.assertIn("transfer_to_human", tools)
        self.assertIn("transfer_emergency", tools)
        self.assertNotIn("transfer_call", tools, "the internal method is not a tool")
        human = A.ReceptionistAgent.transfer_to_human.__wrapped__.__code__.co_varnames
        self.assertNotIn("number", human)
        self.assertNotIn("phone", human)


class TransferToHumanTests(FlowCase):
    async def test_a_request_for_a_person_rings_the_business_general_line(self):
        ctx = ctx_for(self.session)
        reply = await self.agent.transfer_to_human(ctx)
        self.assertEqual(self.job.transfers, ["tel:+14389957350"])
        self.assertEqual(self.job.refer_requests[0].participant_identity, "sip_1")
        self.assertIn("handed to the team's phone line", reply)
        self.assertTransfer(
            self.call.transfer,
            {"targetName": "General line", "completed": True, "mechanism": "blind"},
        )
        self.assertFalse(self.call.emergency)

    async def test_a_named_department_rings_that_departments_line(self):
        await self.agent.transfer_to_human(ctx_for(self.session), "billing")
        self.assertEqual(self.job.transfers, ["tel:+14385550002"])
        self.assertTransfer(self.call.transfer, {"targetName": "Billing", "completed": True})

    async def test_an_unknown_department_falls_back_to_the_general_line(self):
        await self.agent.transfer_to_human(ctx_for(self.session), "Sales")
        self.assertEqual(self.job.transfers, ["tel:+14389957350"])

    async def test_the_french_announcement_is_spoken_word_for_word_by_default(self):
        await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertEqual(self.call.language, "fr")
        self.assertIn(FR_NORMAL, self.session.replies[0])
        self.assertIn("word for word", self.session.replies[0])
        self.assertNotIn(EN_NORMAL, self.session.replies[0])

    async def test_after_switching_to_english_the_english_announcement_is_used(self):
        await self.agent.set_language(None, "en")
        self.session.replies.clear()
        await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn(EN_NORMAL, self.session.replies[0])
        self.assertNotIn(FR_NORMAL, self.session.replies[0])

    async def test_the_agent_side_policy_names_the_real_tools(self):
        self.assertIn("transfer_to_human", self.agent.instructions)
        self.assertIn("transfer_emergency", self.agent.instructions)
        self.assertIn("911 is never a transfer destination", self.agent.instructions)

    async def test_the_safe_fallback_prompt_offers_no_transfer(self):
        self.make_agent(cfg=None)
        self.agent._has_config = False
        self.assertNotIn("transfer_to_human", self.agent._instructions_for("fr"))

    async def test_the_request_and_the_accepted_handoff_are_logged_as_events(self):
        with capture(self) as logs:
            await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertEqual(events(logs)[:2], ["transfer_requested", "transfer_accepted"])
        accepted = event_fields(logs, "transfer_accepted")[0]
        self.assertEqual(accepted["mechanism"], "blind")
        self.assertFalse(accepted["answer_confirmed"])
        text = "\n".join(r.getMessage() for r in logs.records)
        self.assertIn("TRANSFER REQUEST ACCEPTED", text)
        self.assertNotIn("HUMAN ANSWER CONFIRMED", text)


class WarmTransferToHumanTests(WarmCase):
    async def test_a_person_who_says_yes_is_a_confirmed_human_answer(self):
        FakeScreened.script = ["connected"]
        with capture(self) as logs:
            reply = await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn("now connected to a person", reply)
        self.assertTransfer(
            self.call.transfer,
            {"completed": True, "answerConfirmed": True, "mechanism": "warm"},
        )
        self.assertIn("HUMAN ANSWER CONFIRMED", "\n".join(r.getMessage() for r in logs.records))
        self.assertTrue(event_fields(logs, "transfer_accepted")[0]["answer_confirmed"])

    async def test_the_screening_call_uses_the_current_language(self):
        await self.agent.set_language(None, "en")
        FakeScreened.script = ["connected"]
        await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn("English", FakeScreened.made[0].language_name)

    async def test_after_hours_a_normal_request_is_refused_without_ringing(self):
        cfg = copy.deepcopy(CFG)
        cfg["afterHours"] = True
        self.make_agent(cfg)
        reply = await self.agent.transfer_to_human(ctx_for(self.session))
        self.assertIn("closed", reply)
        self.assertEqual(FakeScreened.made, [])


if __name__ == "__main__":
    unittest.main()
