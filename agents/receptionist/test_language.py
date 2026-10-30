import unittest

from language import LanguageMenu
from policy import SilencePolicy


class LanguageMenuTests(unittest.TestCase):
    def menu(self, start="fr", languages=("fr", "en"), keys=None):
        return LanguageMenu(languages, start, keys)

    def test_every_call_starts_in_french_with_the_menu_open(self):
        menu = self.menu()
        self.assertEqual(menu.language, "fr")
        self.assertTrue(menu.is_open)

    def test_key_1_chooses_english_and_closes_the_menu(self):
        menu = self.menu()
        choice = menu.on_digit("1")
        self.assertEqual((choice.language, choice.chosen), ("en", True))
        self.assertEqual(menu.language, "en")
        self.assertFalse(menu.is_open)

    def test_key_2_chooses_french(self):
        choice = self.menu().on_digit("2")
        self.assertEqual((choice.language, choice.chosen), ("fr", True))

    def test_other_keys_do_nothing_and_leave_the_menu_open(self):
        menu = self.menu()
        for digit in ("0", "3", "5", "9", "*", "#"):
            self.assertIsNone(menu.on_digit(digit))
        self.assertTrue(menu.is_open)
        self.assertEqual(menu.language, "fr")

    def test_no_key_keeps_french_and_asks_the_opening_question(self):
        menu = self.menu()
        choice = menu.on_timeout()
        self.assertEqual((choice.language, choice.chosen), ("fr", False))
        self.assertFalse(menu.is_open)

    def test_the_timeout_fires_only_once(self):
        menu = self.menu()
        menu.on_timeout()
        self.assertIsNone(menu.on_timeout())

    def test_speech_never_chooses_the_language(self):
        menu = self.menu()
        menu.on_speech()
        self.assertEqual(menu.language, "fr")
        self.assertFalse(menu.is_open)
        self.assertIsNone(menu.on_timeout())

    def test_a_key_after_the_menu_closed_cannot_restart_the_greeting(self):
        menu = self.menu()
        menu.on_digit("1")
        self.assertIsNone(menu.on_digit("2"))
        self.assertEqual(menu.language, "en")

    def test_a_single_language_line_has_no_menu(self):
        menu = self.menu(start="en", languages=("en",))
        self.assertFalse(menu.is_open)
        self.assertIsNone(menu.on_digit("1"))
        self.assertIsNone(menu.on_timeout())
        self.assertEqual(menu.language, "en")

    def test_a_start_language_that_is_not_enabled_falls_back_to_an_enabled_one(self):
        self.assertEqual(self.menu(start="en", languages=("fr",)).language, "fr")

    def test_keys_for_a_language_that_is_not_enabled_are_ignored(self):
        menu = self.menu(languages=("fr", "de"), keys={"1": "en", "2": "fr"})
        self.assertIsNone(menu.on_digit("1"))

    def test_verbal_switch_changes_the_language_once(self):
        menu = self.menu()
        menu.on_speech()
        self.assertTrue(menu.switch("en"))
        self.assertEqual(menu.language, "en")
        self.assertFalse(menu.switch("en"))
        self.assertFalse(menu.switch("de"))
        self.assertEqual(menu.language, "en")


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
        policy = SilencePolicy(max_check_ins=2)
        results = [policy.on_quiet() for _ in range(5)]
        self.assertEqual(results, ["check_in", "check_in", "goodbye", "goodbye", "goodbye"])


if __name__ == "__main__":
    unittest.main()
