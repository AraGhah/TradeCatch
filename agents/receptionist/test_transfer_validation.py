"""Which numbers a transfer may ring: only the tenant's own, safe, configured lines."""

import asyncio
import copy
import unittest

from routing import destination_problem, plan_transfer
from transfer import TRANSFER_EVENTS, format_event, transfer_event

CFG = {
    "afterHours": False,
    "transferE164": "+14389957350",
    "emergencyTransferE164": "+14385550001",
    "backupTransferE164": "+14385550003",
    "departments": [{"name": "Billing", "phoneE164": "+14385550002"}],
}
BUSINESS = "+14382314700"
CALLER = "+15145550142"


def numbers(plan):
    return [t.number for t in plan.targets]


class DestinationTests(unittest.TestCase):
    def test_a_valid_north_american_number_is_accepted(self):
        self.assertIsNone(destination_problem("+14389957350", business_number=BUSINESS, caller=CALLER))

    def test_an_international_number_is_accepted(self):
        self.assertIsNone(destination_problem("+33142685300"))

    def test_emergency_and_service_codes_are_refused(self):
        for value in ("911", "+911", "112", "+19115551234", "+15149111234"):
            with self.subTest(value=value):
                self.assertEqual(destination_problem(value), "emergency_service")
        self.assertEqual(destination_problem("+14384111234"), "service_code")

    def test_premium_rate_lines_are_refused(self):
        self.assertEqual(destination_problem("+19005551234"), "premium_rate")

    def test_malformed_values_are_refused(self):
        for value in ("4389957350", "+1 438 995 7350", "tel:+14389957350", "+1438", "+10385550100"):
            with self.subTest(value=value):
                self.assertEqual(destination_problem(value), "invalid_format")
        self.assertEqual(destination_problem(""), "missing")
        self.assertEqual(destination_problem(None), "missing")

    def test_the_business_line_itself_would_loop_back_into_the_agent(self):
        self.assertEqual(destination_problem(BUSINESS, business_number=BUSINESS), "business_line")

    def test_the_caller_is_never_rung_back_as_a_transfer(self):
        self.assertEqual(destination_problem(CALLER, caller=CALLER), "caller_number")


class PlanValidationTests(unittest.TestCase):
    def test_a_valid_plan_keeps_its_order(self):
        plan = plan_transfer(CFG, "caller_request", business_number=BUSINESS, caller=CALLER)
        self.assertEqual(numbers(plan), ["+14389957350", "+14385550003"])
        self.assertEqual(plan.rejected, ())

    def test_an_unsafe_line_is_skipped_and_the_next_one_is_used(self):
        cfg = {**CFG, "transferE164": BUSINESS}
        plan = plan_transfer(cfg, "caller_request", business_number=BUSINESS, caller=CALLER)
        self.assertEqual(numbers(plan), ["+14385550003"])
        self.assertEqual(plan.rejected, ("business_line",))

    def test_when_every_line_is_unsafe_the_plan_refuses_with_a_callback(self):
        cfg = {"afterHours": False, "transferE164": "+19005551234"}
        plan = plan_transfer(cfg, "caller_request", business_number=BUSINESS)
        self.assertEqual(plan.targets, ())
        self.assertIn("callback", plan.refusal)
        self.assertEqual(plan.rejected, ("premium_rate",))

    def test_missing_configuration_refuses_without_a_number(self):
        plan = plan_transfer({"afterHours": False}, "caller_request")
        self.assertEqual(plan.targets, ())
        self.assertIn("callback", plan.refusal)
        emergency = plan_transfer({"afterHours": False}, "emergency")
        self.assertIn("911", emergency.refusal)

    def test_a_number_given_as_a_department_name_is_ignored(self):
        plan = plan_transfer(CFG, "caller_request", "+19005551234")
        self.assertEqual(numbers(plan)[0], "+14389957350")
        self.assertNotIn("+19005551234", numbers(plan))

    def test_another_tenants_department_cannot_be_reached(self):
        other_tenant = {
            "afterHours": False,
            "transferE164": "+14185550000",
            "departments": [{"name": "Billing", "phoneE164": "+14185550009"}],
        }
        mine = {k: v for k, v in CFG.items() if k != "departments"}
        plan = plan_transfer(mine, "caller_request", "Billing")
        self.assertNotIn("+14185550009", numbers(plan))
        self.assertEqual(numbers(plan)[0], "+14389957350")
        # And the other tenant's plan never contains this tenant's lines.
        self.assertNotIn("+14389957350", numbers(plan_transfer(other_tenant, "caller_request", "Billing")))


class LogSafetyTests(unittest.TestCase):
    def test_only_allow_listed_fields_survive_and_numbers_are_masked(self):
        fields = transfer_event(
            "transfer_failed",
            call_id="call-abc123",
            target="Line 4389957350",
            number="+14389957350",
            transcript="my address is 12 Main",
            failure="no_answer",
            sip_status=480,
        )
        self.assertNotIn("number", fields)
        self.assertNotIn("transcript", fields)
        self.assertNotIn("4389957350", str(fields))
        self.assertEqual(fields["failure"], "no_answer")
        self.assertEqual(fields["sip_status"], 480)
        self.assertTrue(format_event(fields).startswith("transfer_failed "))

    def test_the_six_event_names_are_fixed(self):
        self.assertEqual(
            set(TRANSFER_EVENTS),
            {
                "transfer_requested",
                "transfer_accepted",
                "transfer_failed",
                "transfer_timeout",
                "transfer_fallback_started",
                "transfer_fallback_completed",
            },
        )
        with self.assertRaises(ValueError):
            transfer_event("transfer_succeeded")


try:
    import agent as A
    from test_agent_flow import CFG as FLOW_CFG
    from test_agent_flow import FakeSession, FlowCase, Harness, ctx_for
    from transfer_testing import all_log_text, capture
except ImportError:  # livekit-agents is not installed here: the pure tests above still run
    FlowCase = None

if FlowCase is not None:

    class AgentValidationTests(FlowCase):
        async def test_no_config_means_no_transfer_and_a_callback(self):
            self.make_agent(cfg=None)
            self.agent._has_config = False
            reply = await self.agent.transfer_to_human(ctx_for(self.session))
            self.assertIn("unavailable", reply)
            self.assertEqual(self.job.transfers, [])

        async def test_a_saved_line_equal_to_the_business_number_is_never_rung(self):
            cfg = copy.deepcopy(FLOW_CFG)
            cfg["transferE164"] = self.call.number
            cfg["backupTransferE164"] = "+14385550003"
            self.make_agent(cfg)
            await self.agent.transfer_to_human(ctx_for(self.session))
            self.assertEqual(self.job.transfers, ["tel:+14385550003"])

        async def test_a_saved_line_equal_to_the_callers_number_is_never_rung(self):
            cfg = copy.deepcopy(FLOW_CFG)
            cfg["transferE164"] = self.call.from_e164
            self.make_agent(cfg)
            reply = await self.agent.transfer_to_human(ctx_for(self.session))
            self.assertEqual(self.job.transfers, [])
            self.assertIn("callback", reply)
            self.assertFalse(self.call.transfer["completed"])

        async def test_no_phone_number_ever_reaches_the_logs(self):
            with capture(self) as logs:
                await self.agent.transfer_to_human(ctx_for(self.session))
                self.job.transfers.clear()
            text = all_log_text(logs)
            for secret in ("4389957350", "4382314700", "5145550142"):
                self.assertNotIn(secret, text)

        async def test_concurrent_calls_for_two_tenants_never_mix_destinations(self):
            other_cfg = copy.deepcopy(FLOW_CFG)
            other_cfg["transferE164"] = "+14185550000"
            other_cfg["emergencyTransferE164"] = "+14185550001"
            other_cfg["departments"] = []
            other = Harness(
                cfg=other_cfg,
                call=A.CallRecord(call_id="call-other1", number="+14185559999", from_e164=None),
                client=self.client,
                sip_identity="sip_other",
                transfers=self.transfers,
            )
            other.fake_session = FakeSession()
            other._ctx = self.job
            await asyncio.gather(
                self.agent.transfer_to_human(ctx_for(self.session)),
                other.transfer_emergency(ctx_for(other.fake_session)),
            )
            pairs = {(r.participant_identity, r.transfer_to) for r in self.job.refer_requests}
            self.assertEqual(
                pairs, {("sip_1", "tel:+14389957350"), ("sip_other", "tel:+14185550001")}
            )
            self.assertFalse(self.call.emergency)
            self.assertTrue(other._call.emergency)


if __name__ == "__main__":
    unittest.main()
