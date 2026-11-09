import unittest

from language import (
    CallLanguage,
    Heard,
    base_language,
    detection_enabled,
)
from policy import SilencePolicy


def clear(language, words=6, confidence=0.9):
    return Heard(language, words, confidence)


def short(language, words=1, confidence=0.9):
    return Heard(language, words, confidence)


def call(**kwargs):
    return CallLanguage(["fr", "en"], "fr", **kwargs)


class DecisionTests(unittest.TestCase):
    def test_a_call_starts_undecided_in_the_start_language(self):
        lang = call()
        self.assertEqual(lang.language, "fr")
        self.assertFalse(lang.decided)
        self.assertTrue(lang.detecting)

    def test_the_first_clear_sentence_decides_english(self):
        lang = call()
        verdict = lang.observe(clear("en"))
        self.assertEqual((verdict.action, verdict.language, verdict.reason), ("set", "en", "clear_speech"))
        self.assertEqual(lang.language, "en")
        self.assertTrue(lang.decided)

    def test_the_first_clear_sentence_decides_french_including_quebec_codes(self):
        for code in ("fr", "fr-CA", "FR_ca"):
            lang = call()
            verdict = lang.observe(clear(code))
            self.assertEqual((verdict.action, verdict.language), ("set", "fr"), code)

    def test_one_short_word_decides_nothing(self):
        lang = call()
        self.assertIsNone(lang.observe(short("en")))
        self.assertFalse(lang.decided)

    def test_two_short_utterances_in_the_same_language_decide(self):
        lang = call()
        self.assertIsNone(lang.observe(short("en", words=2)))
        verdict = lang.observe(short("en", words=1))
        self.assertEqual((verdict.action, verdict.language, verdict.reason), ("set", "en", "short_utterances_agree"))

    def test_two_short_utterances_that_disagree_lead_to_the_question(self):
        lang = call()
        self.assertIsNone(lang.observe(short("en")))
        verdict = lang.observe(short("fr"))
        self.assertEqual((verdict.action, verdict.reason), ("ask", "unclear"))
        self.assertTrue(lang.asked)
        self.assertFalse(lang.decided)

    def test_a_low_confidence_sentence_is_not_clear(self):
        lang = call()
        self.assertIsNone(lang.observe(clear("en", confidence=0.3)))
        self.assertFalse(lang.decided)

    def test_a_recogniser_without_confidence_still_counts_long_enough_speech(self):
        lang = call()
        self.assertEqual(lang.observe(Heard("en", 5, None)).action, "set")

    def test_a_language_the_line_does_not_offer_does_not_decide(self):
        lang = call()
        self.assertIsNone(lang.observe(clear("es")))
        self.assertEqual(lang.observe(clear("es")).action, "ask")

    def test_an_unknown_label_counts_as_unclear(self):
        lang = call()
        self.assertIsNone(lang.observe(Heard(None, 6, 0.9)))
        self.assertEqual(lang.observe(Heard("", 6, 0.9)).action, "ask")

    def test_it_asks_only_once(self):
        lang = call()
        lang.observe(clear("es"))
        self.assertEqual(lang.observe(clear("es")).action, "ask")
        self.assertIsNone(lang.observe(clear("es", words=2)))


class AnswerTests(unittest.TestCase):
    def asked(self):
        lang = call()
        lang.observe(clear("es"))
        lang.observe(clear("es"))
        return lang

    def test_a_one_word_answer_decides_after_the_question(self):
        lang = self.asked()
        verdict = lang.observe(short("en"))
        self.assertEqual((verdict.action, verdict.language, verdict.reason), ("set", "en", "answered_question"))

    def test_a_french_answer_decides_french(self):
        verdict = self.asked().observe(short("fr-CA"))
        self.assertEqual((verdict.action, verdict.language), ("set", "fr"))

    def test_two_unusable_answers_fall_back_to_the_start_language(self):
        lang = self.asked()
        self.assertIsNone(lang.observe(clear("es")))
        verdict = lang.observe(Heard(None, 2, 0.5))
        self.assertEqual((verdict.action, verdict.language, verdict.reason), ("fallback", "fr", "no_answer"))
        self.assertTrue(lang.decided)
        self.assertEqual(lang.language, "fr")

    def test_a_question_the_model_asked_itself_makes_the_next_words_the_answer(self):
        lang = call()
        lang.note_asked()
        verdict = lang.observe(short("en"))
        self.assertEqual((verdict.action, verdict.reason), ("set", "answered_question"))

    def test_note_asked_does_nothing_once_decided(self):
        lang = call()
        lang.observe(clear("en"))
        lang.note_asked()
        self.assertFalse(lang.asked)


class HysteresisTests(unittest.TestCase):
    def decided(self, language="fr"):
        lang = call()
        lang.observe(clear(language))
        return lang

    def test_the_same_language_changes_nothing(self):
        lang = self.decided("fr")
        self.assertIsNone(lang.observe(clear("fr")))
        self.assertEqual(lang.language, "fr")

    def test_one_clear_sentence_in_the_other_language_does_not_switch(self):
        lang = self.decided("fr")
        self.assertIsNone(lang.observe(clear("en", words=5)))
        self.assertEqual(lang.language, "fr")

    def test_two_clear_sentences_in_a_row_switch(self):
        lang = self.decided("fr")
        self.assertIsNone(lang.observe(clear("en", words=5)))
        verdict = lang.observe(clear("en", words=5))
        self.assertEqual((verdict.action, verdict.language, verdict.reason), ("switch", "en", "sustained_speech"))
        self.assertEqual(lang.language, "en")

    def test_a_sentence_in_the_current_language_resets_the_streak(self):
        lang = self.decided("fr")
        lang.observe(clear("en", words=5))
        self.assertIsNone(lang.observe(clear("fr", words=5)))
        self.assertIsNone(lang.observe(clear("en", words=5)))
        self.assertEqual(lang.language, "fr")

    def test_borrowed_words_and_short_replies_never_switch(self):
        lang = self.decided("fr")
        for _ in range(10):
            self.assertIsNone(lang.observe(short("en", words=1)))
            self.assertIsNone(lang.observe(short("en", words=2)))
        self.assertEqual(lang.language, "fr")

    def test_short_replies_do_not_break_a_streak_either(self):
        lang = self.decided("fr")
        lang.observe(clear("en", words=5))
        self.assertIsNone(lang.observe(short("fr", words=1)))
        self.assertEqual(lang.observe(clear("en", words=5)).action, "switch")

    def test_one_long_confident_sentence_switches_on_its_own(self):
        lang = self.decided("fr")
        verdict = lang.observe(Heard("en", 12, 0.95))
        self.assertEqual((verdict.action, verdict.language), ("switch", "en"))

    def test_a_long_but_unsure_sentence_does_not(self):
        lang = self.decided("fr")
        self.assertIsNone(lang.observe(Heard("en", 12, 0.7)))

    def test_an_unoffered_language_never_switches_a_decided_call(self):
        lang = self.decided("fr")
        for _ in range(5):
            self.assertIsNone(lang.observe(clear("es", words=12)))
        self.assertEqual(lang.language, "fr")

    def test_it_can_switch_back_again(self):
        lang = self.decided("fr")
        lang.observe(clear("en"))
        lang.observe(clear("en"))
        lang.observe(clear("fr"))
        self.assertEqual(lang.observe(clear("fr")).language, "fr")


class ExplicitRequestTests(unittest.TestCase):
    def test_a_request_switches_at_once_and_decides_the_call(self):
        lang = call()
        self.assertTrue(lang.switch("en"))
        self.assertEqual(lang.language, "en")
        self.assertTrue(lang.decided)

    def test_asking_for_the_current_language_changes_nothing_but_decides(self):
        lang = call()
        self.assertFalse(lang.switch("fr"))
        self.assertTrue(lang.decided)

    def test_a_language_the_line_does_not_offer_is_refused(self):
        lang = call()
        self.assertFalse(lang.switch("es"))
        self.assertFalse(lang.decided)

    def test_after_a_request_it_takes_three_clear_sentences_to_overrule_it(self):
        lang = call()
        lang.switch("en")
        self.assertIsNone(lang.observe(clear("fr")))
        self.assertIsNone(lang.observe(clear("fr")))
        self.assertEqual(lang.observe(clear("fr")).action, "switch")

    def test_a_long_confident_sentence_does_not_overrule_a_request(self):
        lang = call()
        lang.switch("en")
        self.assertIsNone(lang.observe(Heard("fr", 15, 0.99)))

    def test_a_request_settles_a_pending_question(self):
        lang = call()
        lang.observe(clear("es"))
        lang.observe(clear("es"))
        lang.switch("fr")
        self.assertIsNone(lang.observe(clear("fr")))


class FailureTests(unittest.TestCase):
    def test_a_failed_detector_keeps_the_language_and_stops_deciding(self):
        lang = call()
        lang.observe(clear("en"))
        verdict = lang.fail()
        self.assertEqual((verdict.action, verdict.language, verdict.reason), ("fallback", "en", "detector_unavailable"))
        self.assertFalse(lang.detecting)
        self.assertIsNone(lang.observe(clear("fr")))
        self.assertIsNone(lang.observe(clear("fr")))
        self.assertEqual(lang.language, "en")

    def test_failing_before_a_decision_keeps_the_start_language(self):
        lang = call()
        verdict = lang.fail()
        self.assertEqual(verdict.reason, "detector_unavailable_undecided")
        self.assertEqual(lang.language, "fr")

    def test_it_only_fails_once(self):
        lang = call()
        self.assertIsNotNone(lang.fail())
        self.assertIsNone(lang.fail())

    def test_an_explicit_request_still_works_after_a_failure(self):
        lang = call()
        lang.fail()
        self.assertTrue(lang.switch("en"))
        self.assertEqual(lang.language, "en")


class ConfigurationTests(unittest.TestCase):
    def test_a_single_language_line_has_nothing_to_decide(self):
        lang = CallLanguage(["en"], "en")
        self.assertTrue(lang.decided)
        self.assertFalse(lang.detecting)
        self.assertIsNone(lang.observe(clear("fr")))
        self.assertEqual(lang.language, "en")
        self.assertIsNone(lang.fail())

    def test_a_start_language_that_is_not_enabled_falls_back_to_an_enabled_one(self):
        self.assertEqual(CallLanguage(["en"], "fr").language, "en")

    def test_detection_can_be_turned_off(self):
        lang = call(detect=False)
        self.assertFalse(lang.detecting)
        self.assertIsNone(lang.observe(clear("en")))
        self.assertEqual(lang.language, "fr")
        self.assertTrue(lang.switch("en"))

    def test_the_kill_switch_reads_the_environment(self):
        self.assertTrue(detection_enabled({}))
        self.assertTrue(detection_enabled({"AGENT_LANGUAGE_DETECTION": "on"}))
        for off in ("off", "OFF", "0", "false", "no"):
            self.assertFalse(detection_enabled({"AGENT_LANGUAGE_DETECTION": off}), off)

    def test_language_codes_are_reduced_to_the_language(self):
        self.assertEqual(base_language("fr-CA"), "fr")
        self.assertEqual(base_language("EN_us"), "en")
        self.assertIsNone(base_language(None))
        self.assertIsNone(base_language(""))


class SilencePolicyTests(unittest.TestCase):
    def test_checks_in_once_then_says_goodbye(self):
        policy = SilencePolicy(max_check_ins=1)
        self.assertEqual(policy.on_quiet(), "check_in")
        self.assertEqual(policy.on_quiet(), "goodbye")

    def test_a_caller_who_answers_gets_a_fresh_check_in_next_time(self):
        policy = SilencePolicy(max_check_ins=1)
        policy.on_quiet()
        policy.on_activity()
        self.assertEqual(policy.on_quiet(), "check_in")

    def test_zero_check_ins_ends_on_the_first_silence(self):
        self.assertEqual(SilencePolicy(max_check_ins=0).on_quiet(), "goodbye")

    def test_goodbye_is_final(self):
        policy = SilencePolicy(max_check_ins=1)
        policy.on_quiet()
        policy.on_quiet()
        self.assertEqual(policy.on_quiet(), "goodbye")


if __name__ == "__main__":
    unittest.main()
