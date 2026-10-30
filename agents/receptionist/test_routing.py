import unittest

from routing import dialed_number, pick_transfer

CFG = {
    "transferE164": "+14389957350",
    "emergencyTransferE164": "+14385550001",
    "afterHours": False,
    "departments": [{"name": "Billing", "phoneE164": "+14385550002"}],
}


class PickTransfer(unittest.TestCase):
    def test_caller_request_goes_to_the_general_line(self):
        self.assertEqual(pick_transfer(CFG, "caller_request").number, "+14389957350")

    def test_department_matches_case_insensitively(self):
        self.assertEqual(
            pick_transfer(CFG, "caller_request", " billing ").number, "+14385550002"
        )

    def test_unknown_department_falls_back_to_general_line(self):
        self.assertEqual(
            pick_transfer(CFG, "caller_request", "sales").number, "+14389957350"
        )

    def test_a_number_smuggled_in_as_department_is_never_dialed(self):
        decision = pick_transfer(CFG, "caller_request", "+19005551234")
        self.assertEqual(decision.number, "+14389957350")

    def test_emergency_uses_the_emergency_line_even_after_hours(self):
        decision = pick_transfer({**CFG, "afterHours": True}, "emergency")
        self.assertEqual(decision.number, "+14385550001")

    def test_normal_transfer_is_refused_after_hours(self):
        decision = pick_transfer({**CFG, "afterHours": True}, "caller_request")
        self.assertIsNone(decision.number)
        self.assertIn("closed", decision.refusal)

    def test_no_line_configured_explains_instead_of_dialing(self):
        decision = pick_transfer({"departments": []}, "caller_request")
        self.assertIsNone(decision.number)
        self.assertIsNotNone(decision.refusal)

    def test_emergency_without_a_line_points_to_911(self):
        decision = pick_transfer({"departments": []}, "emergency")
        self.assertIsNone(decision.number)
        self.assertIn("911", decision.refusal)


class DialedNumber(unittest.TestCase):
    def test_reads_the_trunk_number(self):
        self.assertEqual(
            dialed_number({"sip.trunkPhoneNumber": "+14382314700"}), "+14382314700"
        )

    def test_missing_attribute(self):
        self.assertIsNone(dialed_number({}))


if __name__ == "__main__":
    unittest.main()
