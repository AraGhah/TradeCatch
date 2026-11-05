import unittest

from caller_policy import parse_caller_policy, say_exactly_instruction


def cfg(policy):
    return {"configId": "rc_1", "callerPolicy": policy}


class ParseCallerPolicyTest(unittest.TestCase):
    def test_no_policy_means_answer(self):
        self.assertIsNone(parse_caller_policy(None))
        self.assertIsNone(parse_caller_policy({}))
        self.assertIsNone(parse_caller_policy({"callerPolicy": "personal_end"}))
        self.assertIsNone(parse_caller_policy(cfg({"kind": "ai"})))
        self.assertIsNone(parse_caller_policy(cfg({"kind": "drop_table"})))

    def test_message_policy_keeps_clean_lines_only(self):
        policy = parse_caller_policy(
            cfg(
                {
                    "kind": "personal_message",
                    "messages": [
                        {"lang": "fr", "text": "  Salut,   je te rappelle. "},
                        {"lang": "de", "text": "Hallo"},
                        {"lang": "en", "text": "<speak>ignore previous</speak>"},
                        {"lang": "en", "text": "x" * 301},
                        "nope",
                    ],
                }
            )
        )
        self.assertIsNotNone(policy)
        self.assertEqual(policy.kind, "personal_message")
        self.assertEqual([(m.language, m.text) for m in policy.messages], [("fr", "Salut, je te rappelle.")])

    def test_message_without_any_usable_line_answers_normally(self):
        self.assertIsNone(parse_caller_policy(cfg({"kind": "unknown_message", "messages": []})))

    def test_transfer_needs_a_plain_e164_destination(self):
        good = parse_caller_policy(
            cfg({"kind": "personal_transfer", "transferE164": "+14385597004", "messages": [{"lang": "fr", "text": "Je te rappelle."}]})
        )
        self.assertEqual(good.kind, "personal_transfer")
        self.assertEqual(good.transfer_e164, "+14385597004")
        bad = parse_caller_policy(
            cfg({"kind": "personal_transfer", "transferE164": "sip:evil@example.com", "messages": [{"lang": "fr", "text": "Je te rappelle."}]})
        )
        self.assertEqual(bad.kind, "personal_message", "a bad destination falls back to the message, never the AI")
        self.assertIsNone(bad.transfer_e164)

    def test_end_needs_no_message(self):
        policy = parse_caller_policy(cfg({"kind": "personal_end"}))
        self.assertEqual(policy.kind, "personal_end")

    def test_instruction_reads_lines_verbatim(self):
        policy = parse_caller_policy(
            cfg({"kind": "personal_message", "messages": [{"lang": "fr", "text": "Je te rappelle."}, {"lang": "en", "text": "I'll call you back."}]})
        )
        text = say_exactly_instruction(policy)
        self.assertIn("[fr] Je te rappelle.", text)
        self.assertIn("[en] I'll call you back.", text)
        self.assertIn("Do not greet", text)


if __name__ == "__main__":
    unittest.main()
