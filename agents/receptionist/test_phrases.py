import unittest

import phrases

CFG = {
    "businessName": "Acme",
    "languageSelect": {
        "startLanguage": "fr",
        "languages": ["fr", "en"],
        # What the server also sends for the earlier, keypad-based agent: ignored now.
        "timeoutSeconds": 3,
        "keys": {"1": "en", "2": "fr"},
        "opening": {
            "statement": {"text": "Bonjour! Merci d'avoir appelé Acme.", "lang": "fr"},
            "menu": [
                {"text": "Pour continuer en français, restez en ligne.", "lang": "fr"},
                {"text": "For English, press 1.", "lang": "en"},
            ],
        },
        "detection": {
            "opening": [
                {"text": "Bonjour, ici Acme.", "lang": "fr"},
                {"text": "How can I help you?", "lang": "en"},
            ],
            "ask": [
                {"text": "Français ou anglais?", "lang": "fr"},
                {"text": "French or English?", "lang": "en"},
            ],
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
    def test_the_greeting_is_bilingual_in_one_pass(self):
        text = phrases.opening_instruction(CFG)
        self.assertLess(text.index("Bonjour, ici Acme."), text.index("How can I help you?"))
        self.assertIn('[Canadian French (Québec)] "Bonjour, ici Acme."', text)
        self.assertIn('[North American English] "How can I help you?"', text)

    def test_there_is_no_keypad_menu_in_the_opening(self):
        text = phrases.opening_instruction(CFG)
        self.assertNotIn("press", text.lower())
        self.assertNotIn("restez en ligne", text)
        self.assertNotIn("appuyez", text.lower())

    def test_an_older_server_gets_the_same_greeting_from_the_business_name(self):
        older = {"businessName": "Acme", "languageSelect": {"opening": CFG["languageSelect"]["opening"]}}
        text = phrases.opening_instruction(older)
        self.assertIn('"Bonjour, ici Acme."', text)
        self.assertIn('"How can I help you?"', text)
        self.assertNotIn("press 1", text)

    def test_an_empty_config_still_greets_in_both_languages(self):
        text = phrases.opening_instruction({})
        self.assertIn("Bonjour", text)
        self.assertIn("How can I help you?", text)

    def test_a_single_language_line_greets_and_asks_in_that_language(self):
        cfg = {
            "businessName": "Acme",
            "languageSelect": {"startLanguage": "en", "languages": ["en"]},
        }
        lines = phrases.opening_lines(cfg)
        self.assertTrue(all(lang == "en" for lang, _ in lines))
        self.assertIn("Acme", lines[0][1])
        self.assertIn("How can I help you today?", phrases.opening_instruction(cfg))

    def test_malformed_server_lines_are_ignored(self):
        cfg = {"businessName": "Acme", "languageSelect": {"detection": {"opening": [{"text": 5}, "x", {"text": " "}]}}}
        self.assertIn("Bonjour, ici Acme.", phrases.opening_instruction(cfg))

    def test_the_model_is_told_to_add_nothing(self):
        self.assertIn("Add nothing else", phrases.opening_instruction(CFG))


class AskTests(unittest.TestCase):
    def test_asks_in_both_languages_in_their_own_voices(self):
        text = phrases.ask_instruction(CFG)
        self.assertIn('[Canadian French (Québec)] "Français ou anglais?"', text)
        self.assertIn('[North American English] "French or English?"', text)

    def test_falls_back_to_the_standard_question(self):
        text = phrases.ask_instruction({})
        self.assertIn("Français ou anglais?", text)
        self.assertIn("French or English?", text)

    def test_recognises_the_question_whoever_asked_it(self):
        self.assertTrue(phrases.spoken_ask("Français ou anglais? French or English?"))
        self.assertTrue(phrases.spoken_ask("Sorry, French or English?"))
        self.assertTrue(phrases.spoken_ask("francais ou anglais"))
        self.assertFalse(phrases.spoken_ask("Bonjour, ici Acme. How can I help you?"))
        self.assertFalse(phrases.spoken_ask(None))


class SettingsTests(unittest.TestCase):
    def test_reads_the_language_settings(self):
        self.assertEqual(phrases.start_language(CFG), "fr")
        self.assertEqual(phrases.enabled_languages(CFG), ["fr", "en"])

    def test_defaults_when_the_server_is_older(self):
        self.assertEqual(phrases.start_language(None), "fr")
        self.assertEqual(phrases.enabled_languages({}), ["fr", "en"])

    def test_the_keypad_settings_are_gone(self):
        self.assertFalse(hasattr(phrases, "menu_keys"))
        self.assertFalse(hasattr(phrases, "menu_timeout_seconds"))
        self.assertFalse(hasattr(phrases, "after_choice"))

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


class QuietTests(unittest.TestCase):
    def test_a_known_language_is_spoken_in_that_language_only(self):
        text = phrases.quiet_instruction(CFG, "en", "check_in")
        self.assertIn('[North American English] "Still with me?"', text)
        self.assertNotIn("Vous êtes là?", text)

    def test_an_unknown_language_is_spoken_in_both_start_language_first(self):
        text = phrases.quiet_instruction(CFG, None, "check_in")
        self.assertLess(text.index("Vous êtes là?"), text.index("Still with me?"))

    def test_the_goodbye_is_bilingual_too_before_the_language_is_known(self):
        text = phrases.quiet_instruction(CFG, None, "goodbye")
        self.assertIn("Au revoir!", text)
        self.assertIn("Goodbye!", text)


class SayTests(unittest.TestCase):
    def test_says_one_fixed_line_in_the_given_language(self):
        text = phrases.say_instruction("fr", "Êtes-vous toujours là?")
        self.assertIn('[Canadian French (Québec)] "Êtes-vous toujours là?"', text)
        self.assertIn("Add nothing else", text)


class DirectiveTests(unittest.TestCase):
    def test_a_known_language_is_locked_and_the_greeting_is_never_replayed(self):
        text = phrases.language_directive("en")
        self.assertIn("North American English", text)
        self.assertIn("Never repeat the greeting", text)
        self.assertNotIn("menu", text.lower())

    def test_french_directive_names_quebec_french(self):
        self.assertIn("Québec", phrases.language_directive("fr"))

    def test_an_unknown_language_follows_the_caller_and_asks_when_unsure(self):
        text = phrases.language_directive(None)
        self.assertIn("not known yet", text)
        self.assertIn("Reply in the language the caller speaks", text)
        self.assertIn("Français ou anglais? French or English?", text)

    def test_with_detection_the_model_switches_only_when_asked(self):
        text = phrases.language_directive("fr", detecting=True)
        self.assertIn("LANGUAGE UPDATE", text)
        self.assertIn("only when the caller asks, out loud", text)
        self.assertNotIn("clearly talks to you in full sentences", text)

    def test_without_detection_the_model_switches_on_full_sentences(self):
        text = phrases.language_directive("fr", detecting=False)
        self.assertIn("clearly talks to you in full sentences", text)

    def test_never_switches_for_an_accent_a_borrowed_word_or_a_name(self):
        for detecting in (True, False):
            for language in ("fr", "en", None):
                self.assertIn(
                    "Do not switch because of an accent, a borrowed word or a name",
                    phrases.language_directive(language, detecting=detecting),
                )

    def test_offers_french_or_english_for_any_other_language(self):
        self.assertIn("can help in either, and ask which they prefer", phrases.language_directive("en"))

    def test_the_update_rules_never_mention_a_menu(self):
        self.assertNotIn("menu", phrases.language_update("en").lower())
        self.assertIn("Automatic language detection is not available", phrases.detection_unavailable_update())
        self.assertIn("Français ou anglais? French or English?", phrases.detection_unavailable_update())


if __name__ == "__main__":
    unittest.main()
