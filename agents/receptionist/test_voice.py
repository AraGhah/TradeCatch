import unittest

import voice

KEY = {"ELEVENLABS_API_KEY": "xi-test"}


def cfg(**voice_fields):
    base = {
        "mode": "custom",
        "provider": "elevenlabs",
        "voiceId": "abcDEF1234567890",
        "model": "eleven_flash_v2_5",
    }
    base.update(voice_fields)
    return {"instructions": "x", "voice": base}


class ParseCustomVoiceTest(unittest.TestCase):
    def test_a_valid_custom_voice_is_used(self):
        got = voice.parse_custom_voice(cfg(), KEY)
        self.assertEqual(got.voice_id, "abcDEF1234567890")
        self.assertEqual(got.model, "eleven_flash_v2_5")

    def test_model_defaults_when_omitted(self):
        c = cfg()
        del c["voice"]["model"]
        self.assertEqual(voice.parse_custom_voice(c, KEY).model, voice.DEFAULT_MODEL)

    def test_everything_else_is_the_standard_voice(self):
        bad = [
            None,
            {},
            {"instructions": "x"},  # an older server without a voice field
            {"voice": None},
            {"voice": "custom"},
            {"voice": {"mode": "standard"}},
            cfg(mode="clone"),
            cfg(provider="someone-else"),
            cfg(voiceId=""),
            cfg(voiceId="short"),
            cfg(voiceId="has spaces and ../ chars"),
            cfg(voiceId="x" * 41),
            cfg(voiceId=12345678901234),
            cfg(voiceId="abcDEF1234567890\n"),
            cfg(model="gpt-whatever"),
            cfg(model=None),
        ]
        for config in bad:
            self.assertIsNone(voice.parse_custom_voice(config, KEY), config)

    def test_no_api_key_means_standard_voice(self):
        self.assertIsNone(voice.parse_custom_voice(cfg(), {}))
        self.assertIsNone(voice.parse_custom_voice(cfg(), {"ELEVENLABS_API_KEY": "  "}))

    def test_kill_switch(self):
        for off in ("false", "0", "off", "NO"):
            env = {**KEY, "AGENT_CUSTOM_VOICE": off}
            self.assertIsNone(voice.parse_custom_voice(cfg(), env), off)
        env = {**KEY, "AGENT_CUSTOM_VOICE": "true"}
        self.assertIsNotNone(voice.parse_custom_voice(cfg(), env))

    def test_the_voice_id_never_appears_in_a_repr(self):
        got = voice.parse_custom_voice(cfg(), KEY)
        self.assertNotIn("abcDEF1234567890", repr(got))
        self.assertNotIn("abcDEF1234567890", str(got))


class CascadeSettingsTest(unittest.TestCase):
    def test_defaults(self):
        s = voice.cascade_settings({})
        self.assertEqual(s.stt, "deepgram/nova-3")
        self.assertEqual(s.stt_language, "multi")
        self.assertEqual(s.llm, "openai/gpt-6-luna")
        self.assertEqual(s.fallback_tts, "cartesia/sonic-3")

    def test_overrides_are_validated(self):
        s = voice.cascade_settings(
            {
                "AGENT_CUSTOM_VOICE_LLM": "openai/gpt-4.1",
                "AGENT_FALLBACK_TTS": "cartesia/sonic-3:a167e0f3-df7e-4d52-a9c3-f949145efdab",
                "AGENT_CUSTOM_VOICE_STT": "not a model; rm -rf /",
            }
        )
        self.assertEqual(s.llm, "openai/gpt-4.1")
        self.assertEqual(s.fallback_tts, "cartesia/sonic-3:a167e0f3-df7e-4d52-a9c3-f949145efdab")
        self.assertEqual(s.stt, voice.DEFAULT_STT)


STANDARD = {
    **KEY,
    "AGENT_STANDARD_VOICE": "elevenlabs",
    "AGENT_ELEVENLABS_VOICE_ID": "j9RedbMRSNQ74PyikQwD",
}


class StandardVoiceTest(unittest.TestCase):
    def test_off_unless_the_operator_turns_it_on(self):
        env = {k: v for k, v in STANDARD.items() if k != "AGENT_STANDARD_VOICE"}
        self.assertIsNone(voice.standard_voice(env))

    def test_on_with_a_key_and_a_voice_id(self):
        got = voice.standard_voice(STANDARD)
        self.assertEqual((got.voice_id, got.model, got.source), ("j9RedbMRSNQ74PyikQwD", voice.DEFAULT_MODEL, "standard"))
        self.assertIn("j9RedbMRSNQ74PyikQwD", got.describe())

    def test_needs_the_key_a_valid_id_and_no_kill_switch(self):
        for broken in (
            {"ELEVENLABS_API_KEY": ""},
            {"AGENT_ELEVENLABS_VOICE_ID": ""},
            {"AGENT_ELEVENLABS_VOICE_ID": "not a voice id!"},
            {"AGENT_CUSTOM_VOICE": "false"},
        ):
            self.assertIsNone(voice.standard_voice({**STANDARD, **broken}), broken)

    def test_an_unknown_model_falls_back_to_the_fast_default(self):
        got = voice.standard_voice({**STANDARD, "AGENT_ELEVENLABS_MODEL": "eleven_imaginary"})
        self.assertEqual(got.model, voice.DEFAULT_MODEL)
        got = voice.standard_voice({**STANDARD, "AGENT_ELEVENLABS_MODEL": "eleven_v3_conversational"})
        self.assertEqual(got.model, "eleven_v3_conversational")

    def test_a_business_clone_wins_over_the_standard_voice(self):
        got = voice.call_voice(cfg(), STANDARD)
        self.assertEqual((got.voice_id, got.source), ("abcDEF1234567890", "cloned"))
        self.assertNotIn("abcDEF1234567890", got.describe())
        self.assertEqual(voice.call_voice({"instructions": "x"}, STANDARD).source, "standard")
        self.assertIsNone(voice.call_voice({"instructions": "x"}, KEY))


class DeliverySettingsTest(unittest.TestCase):
    def test_unset_keeps_the_voice_own_settings(self):
        self.assertIsNone(voice.delivery_settings({}))

    def test_values_are_read_clamped_and_completed(self):
        got = voice.delivery_settings({"AGENT_ELEVENLABS_SPEED": "2", "AGENT_ELEVENLABS_STYLE": "0"})
        self.assertEqual(got, {"speed": 1.2, "style": 0.0, "stability": 0.5, "similarity_boost": 0.75})

    def test_garbage_is_ignored(self):
        self.assertIsNone(voice.delivery_settings({"AGENT_ELEVENLABS_SPEED": "fast"}))


if __name__ == "__main__":
    unittest.main()
