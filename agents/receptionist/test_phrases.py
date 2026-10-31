import unittest

import phrases

CFG = {
    "languageSelect": {
        "startLanguage": "fr",
        "languages": ["fr", "en"],
        "timeoutSeconds": 3,
        "keys": {"1": "en", "2": "fr"},
        "opening": {
            "statement": {"text": "Bonjour! Merci d'avoir appelé Acme.", "lang": "fr"},
            "menu": [
                {"text": "Pour continuer en français, restez en ligne.", "lang": "fr"},
                {"text": "For English, press 1.", "lang": "en"},
            ],
        },
        "afterChoice": {
            "fr": {
                "chosen": "Très bien, on continue en français.",
                "afterHoursNotice": "",
                "question": "Comment puis-je vous aider aujourd'hui?",
            },
            "en": {
                "chosen": "Of course, English it is.",
                "afterHoursNotice": "We're closed right now.",
                "question": "How can I help you today?",
            },
        },
    },
    "silence": {
        "checkInSeconds": 6,
        "maxCheckIns": 2,
        "checkIn": {"fr": "Vous êtes là?", "en": "Still with me?"},
        "goodbye": {"fr": "Au revoir!", "en": "Goodbye!"},
    },
}


class OpeningTests(unittest.TestCase):
    def test_greeting_then_menu_in_french_first_order(self):
        text = phrases.opening_instruction(CFG)
        welcome = text.index("Bonjour! Merci d'avoir appelé Acme.")
        stay = text.index("restez en ligne")
        english = text.index("For English, press 1.")
        self.assertLess(welcome, stay)
        self.assertLess(stay, english)

    def test_each_line_names_the_language_it_is_spoken_in(self):
        text = phrases.opening_instruction(CFG)
        self.assertIn('[Canadian French (Québec)] "Bonjour!', text)
        self.assertIn('[North American English] "For English, press 1."', text)

    def test_the_opening_does_not_ask_the_question_before_the_menu_closes(self):
        self.assertNotIn("Comment puis-je vous aider", phrases.opening_instruction(CFG))

    def test_an_older_server_without_the_block_still_gets_a_french_first_menu(self):
        text = phrases.opening_instruction({})
        self.assertIn("restez en ligne", text)
        self.assertIn("For English, press 1.", text)

    def test_a_single_language_line_goes_straight_to_the_question(self):
        cfg = {
            "languageSelect": {
                **CFG["languageSelect"],
                "startLanguage": "en",
                "languages": ["en"],
                "opening": {
                    "statement": {"text": "Hello, Acme.", "lang": "en"},
                    "menu": [],
                },
            }
        }
        text = phrases.opening_instruction(cfg)
        self.assertIn("How can I help you today?", text)
        self.assertNotIn("press 1", text)

    def test_the_model_is_told_to_add_nothing(self):
        self.assertIn("Add nothing else", phrases.opening_instruction(CFG))


class AfterChoiceTests(unittest.TestCase):
    def test_a_key_press_is_acknowledged_before_the_question(self):
        text = phrases.after_choice(CFG, "en", chosen=True)
        self.assertTrue(text.startswith("Of course, English it is."))
        self.assertTrue(text.endswith("How can I help you today?"))

    def test_no_key_goes_straight_to_the_question(self):
        self.assertEqual(
            phrases.after_choice(CFG, "fr", chosen=False),
            "Comment puis-je vous aider aujourd'hui?",
        )

    def test_the_after_hours_notice_comes_before_the_question(self):
        text = phrases.after_choice(CFG, "en", chosen=False)
        self.assertLess(text.index("closed"), text.index("How can I help"))

    def test_missing_copy_falls_back_to_a_plain_question(self):
        self.assertEqual(
            phrases.after_choice({}, "en", chosen=True), "How can I help you today?"
        )
        self.assertIn("Comment puis-je", phrases.after_choice({}, "fr", chosen=False))

    def test_instruction_wraps_the_text_in_the_call_language(self):
        text = phrases.after_choice_instruction(CFG, "en", chosen=True)
        self.assertIn("[North American English]", text)
        self.assertIn("Of course, English it is.", text)


class SettingsTests(unittest.TestCase):
    def test_reads_the_menu_settings(self):
        self.assertEqual(phrases.start_language(CFG), "fr")
        self.assertEqual(phrases.enabled_languages(CFG), ["fr", "en"])
        self.assertEqual(phrases.menu_timeout_seconds(CFG), 3.0)
        self.assertEqual(phrases.menu_keys(CFG), {"1": "en", "2": "fr"})

    def test_defaults_when_the_server_is_older(self):
        self.assertEqual(phrases.start_language(None), "fr")
        self.assertEqual(phrases.enabled_languages({}), ["fr", "en"])
        self.assertEqual(phrases.menu_timeout_seconds({}), 3.0)
        self.assertIsNone(phrases.menu_keys({}))

    def test_a_nonsense_timeout_is_ignored(self):
        bad = {"languageSelect": {"timeoutSeconds": -4}}
        self.assertEqual(phrases.menu_timeout_seconds(bad), 3.0)

    def test_silence_texts_follow_the_call_language(self):
        self.assertEqual(phrases.silence_texts(CFG, "fr"), ("Vous êtes là?", "Au revoir!"))
        self.assertEqual(phrases.silence_texts(CFG, "en"), ("Still with me?", "Goodbye!"))

    def test_silence_texts_have_fallbacks_in_both_languages(self):
        fr_check, fr_bye = phrases.silence_texts({}, "fr")
        en_check, en_bye = phrases.silence_texts({}, "en")
        self.assertIn("toujours là", fr_check)
        self.assertIn("Au revoir", fr_bye)
        self.assertIn("still there", en_check)
        self.assertIn("Goodbye", en_bye)

    def test_silence_settings(self):
        self.assertEqual(phrases.silence_settings(CFG), (6.0, 2))
        self.assertEqual(phrases.silence_settings({}), (8.0, 1))
        self.assertEqual(
            phrases.silence_settings({"silence": {"checkInSeconds": 5, "maxCheckIns": 0}}),
            (5.0, 0),
        )


class SayTests(unittest.TestCase):
    def test_says_one_fixed_line_in_the_given_language(self):
        text = phrases.say_instruction("fr", "Êtes-vous toujours là?")
        self.assertIn('[Canadian French (Québec)] "Êtes-vous toujours là?"', text)
        self.assertIn("Add nothing else", text)


class DirectiveTests(unittest.TestCase):
    def test_locks_the_language_and_forbids_replaying_the_menu(self):
        text = phrases.language_directive("en")
        self.assertIn("North American English", text)
        self.assertIn("set_language", text)
        self.assertIn("Never repeat the greeting", text)

    def test_french_directive_names_quebec_french(self):
        self.assertIn("Québec", phrases.language_directive("fr"))


if __name__ == "__main__":
    unittest.main()
