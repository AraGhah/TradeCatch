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
        self.assertEqual(s.llm, "openai/gpt-4.1-mini")
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


if __name__ == "__main__":
    unittest.main()
