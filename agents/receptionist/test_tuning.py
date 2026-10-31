import unittest

from routing import call_id_from_room, caller_number
from tuning import DEFAULT_MODEL, DEFAULT_VOICE, turn_handling_from_env, voice_settings


class TurnHandlingTests(unittest.TestCase):
    def test_nothing_set_changes_nothing(self):
        self.assertEqual(turn_handling_from_env({}), {})

    def test_reads_every_setting(self):
        options = turn_handling_from_env(
            {
                "AGENT_ENDPOINTING_MODE": "Dynamic",
                "AGENT_MIN_ENDPOINTING_DELAY": "0.4",
                "AGENT_MAX_ENDPOINTING_DELAY": "2.5",
                "AGENT_INTERRUPTIONS": "true",
                "AGENT_INTERRUPTION_MIN_DURATION": "0.6",
                "AGENT_INTERRUPTION_MIN_WORDS": "2",
                "AGENT_PREEMPTIVE_GENERATION": "off",
            }
        )
        self.assertEqual(
            options,
            {
                "endpointing": {"mode": "dynamic", "min_delay": 0.4, "max_delay": 2.5},
                "interruption": {"enabled": True, "min_duration": 0.6, "min_words": 2},
                "preemptive_generation": {"enabled": False},
            },
        )

    def test_values_are_clamped_so_a_typo_cannot_break_the_line(self):
        options = turn_handling_from_env(
            {
                "AGENT_MIN_ENDPOINTING_DELAY": "30",
                "AGENT_INTERRUPTION_MIN_DURATION": "0",
                "AGENT_INTERRUPTION_MIN_WORDS": "99",
            }
        )
        self.assertEqual(options["endpointing"]["min_delay"], 3.0)
        self.assertEqual(options["interruption"]["min_duration"], 0.1)
        self.assertEqual(options["interruption"]["min_words"], 5)

    def test_max_delay_is_never_below_min_delay(self):
        options = turn_handling_from_env(
            {"AGENT_MIN_ENDPOINTING_DELAY": "1.5", "AGENT_MAX_ENDPOINTING_DELAY": "0.5"}
        )
        self.assertEqual(options["endpointing"], {"min_delay": 1.5, "max_delay": 1.5})

    def test_garbage_is_ignored(self):
        options = turn_handling_from_env(
            {
                "AGENT_ENDPOINTING_MODE": "turbo",
                "AGENT_MIN_ENDPOINTING_DELAY": "soon",
                "AGENT_INTERRUPTIONS": "maybe",
            }
        )
        self.assertEqual(options, {})


class VoiceSettingsTests(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual(voice_settings({}), (DEFAULT_MODEL, DEFAULT_VOICE))

    def test_overrides(self):
        env = {"AGENT_REALTIME_MODEL": " openai/other ", "AGENT_VOICE": "cedar"}
        self.assertEqual(voice_settings(env), ("openai/other", "cedar"))


class CallerNumberTests(unittest.TestCase):
    def test_reads_the_sip_caller_id(self):
        self.assertEqual(caller_number({"sip.phoneNumber": "+15145550142"}), "+15145550142")
        self.assertEqual(caller_number({"sip.phoneNumber": "5145550142"}), "+15145550142")
        self.assertEqual(caller_number({"sip.phoneNumber": "15145550142"}), "+15145550142")

    def test_withheld_or_missing_caller_ids_are_none(self):
        for attrs in ({}, {"sip.phoneNumber": ""}, {"sip.phoneNumber": "anonymous"}, {"sip.phoneNumber": "123"}):
            self.assertIsNone(caller_number(attrs), attrs)


class CallIdTests(unittest.TestCase):
    def test_sip_room_names_are_made_safe(self):
        call_id = call_id_from_room("call-_+15145550142_Xy12AbCd", "AJ_job")
        self.assertEqual(call_id, "call-_15145550142_Xy12AbCd")

    def test_same_room_gives_the_same_id_so_retries_cannot_double_record(self):
        self.assertEqual(
            call_id_from_room("call-_+1514_abc", "AJ_1"), call_id_from_room("call-_+1514_abc", "AJ_2")
        )

    def test_a_useless_room_name_falls_back_to_the_job_id(self):
        self.assertEqual(call_id_from_room("+++", "AJ_abc123"), "AJ_abc123")
        self.assertEqual(call_id_from_room("", ""), "call-unknown")

    def test_ids_are_bounded(self):
        self.assertEqual(len(call_id_from_room("a" * 500, "x")), 128)


if __name__ == "__main__":
    unittest.main()
