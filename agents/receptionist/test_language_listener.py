"""The speech-to-text language listener, with a fake stream (no network, no audio)."""

import asyncio
import unittest
from types import SimpleNamespace

from language import Heard
from language_listener import UtteranceGrouper, listen


def final(language, text, confidence=0.9):
    return SimpleNamespace(
        type=SimpleNamespace(value="final_transcript"),
        alternatives=[SimpleNamespace(language=language, text=text, confidence=confidence)],
    )


def interim(language, text):
    return SimpleNamespace(
        type=SimpleNamespace(value="interim_transcript"),
        alternatives=[SimpleNamespace(language=language, text=text, confidence=0.5)],
    )


class FakeStream:
    """A SpeechStream: frames go in, events come out of a queue the test fills."""

    def __init__(self):
        self.frames = []
        self.ended = False
        self.closed = False
        self.events: asyncio.Queue = asyncio.Queue()

    def push_frame(self, frame):
        self.frames.append(frame)

    def end_input(self):
        self.ended = True
        self.events.put_nowait(StopAsyncIteration)

    async def aclose(self):
        self.closed = True

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.events.get()
        if item is StopAsyncIteration:
            raise StopAsyncIteration
        if isinstance(item, Exception):
            raise item
        return item


class Frames:
    """Audio frames the test releases one at a time, then ends."""

    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()

    def put(self, frame):
        self.queue.put_nowait(SimpleNamespace(frame=frame))

    def end(self):
        self.queue.put_nowait(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.queue.get()
        if item is None:
            raise StopAsyncIteration
        return item


class Recorder:
    def __init__(self):
        self.heard: list[Heard] = []
        self.failed: list[str] = []

    def on_heard(self, heard):
        self.heard.append(heard)

    def on_failed(self, why):
        self.failed.append(why)


async def pause(seconds=0.05):
    await asyncio.sleep(seconds)


class GrouperTests(unittest.TestCase):
    def test_the_language_with_the_most_words_wins(self):
        grouper = UtteranceGrouper()
        grouper.add("fr", "je voudrais un", 0.9)
        grouper.add("en", "weekend special offer please", 0.8)
        heard = grouper.take()
        self.assertEqual((heard.language, heard.words), ("en", 7))

    def test_confidence_is_the_mean_weighted_by_words(self):
        grouper = UtteranceGrouper()
        grouper.add("en", "one two three", 0.9)
        grouper.add("en", "four", 0.5)
        self.assertAlmostEqual(grouper.take().confidence, (3 * 0.9 + 1 * 0.5) / 4)

    def test_no_confidence_reported_means_none(self):
        grouper = UtteranceGrouper()
        grouper.add("en", "one two three", None)
        self.assertIsNone(grouper.take().confidence)

    def test_blank_text_is_ignored_and_an_empty_group_gives_nothing(self):
        grouper = UtteranceGrouper()
        grouper.add("en", "   ", 0.9)
        self.assertFalse(grouper)
        self.assertIsNone(grouper.take())

    def test_taking_empties_the_group(self):
        grouper = UtteranceGrouper()
        grouper.add("en", "hello there friend", 0.9)
        grouper.take()
        self.assertIsNone(grouper.take())

    def test_the_result_holds_no_words(self):
        grouper = UtteranceGrouper()
        grouper.add("en", "my secret address is 12 Main Street", 0.9)
        heard = grouper.take()
        self.assertFalse(hasattr(heard, "text"))
        self.assertNotIn("Main Street", repr(heard))


class ListenTests(unittest.IsolatedAsyncioTestCase):
    async def start(self, **kwargs):
        self.frames = Frames()
        self.rec = Recorder()
        self.streams: list[FakeStream] = []

        def make_stream():
            stream = FakeStream()
            self.streams.append(stream)
            return stream

        self.make_stream = kwargs.pop("make_stream", make_stream)
        self.task = asyncio.create_task(
            listen(
                self.frames,
                make_stream=self.make_stream,
                on_heard=self.rec.on_heard,
                on_failed=self.rec.on_failed,
                gap_seconds=kwargs.pop("gap_seconds", 0.05),
                restart_delay=0.0,
                **kwargs,
            )
        )
        await pause()

    async def finish(self):
        self.frames.end()
        await asyncio.wait_for(self.task, 2)

    async def test_audio_frames_reach_the_stream_unwrapped(self):
        await self.start()
        self.frames.put("frame-1")
        self.frames.put("frame-2")
        await pause()
        self.assertEqual(self.streams[0].frames, ["frame-1", "frame-2"])
        await self.finish()
        self.assertTrue(self.streams[0].ended)
        self.assertTrue(self.streams[0].closed)

    async def test_final_transcripts_close_together_make_one_utterance(self):
        await self.start()
        stream = self.streams[0]
        for text in ("I need a", "plumber for my", "kitchen sink"):
            stream.events.put_nowait(final("en", text))
        await pause(0.2)
        self.assertEqual(len(self.rec.heard), 1)
        self.assertEqual((self.rec.heard[0].language, self.rec.heard[0].words), ("en", 8))
        await self.finish()

    async def test_a_pause_between_sentences_makes_two_utterances(self):
        await self.start()
        stream = self.streams[0]
        stream.events.put_nowait(final("fr", "bonjour j'ai une fuite"))
        await pause(0.2)
        stream.events.put_nowait(final("en", "actually in English please"))
        await pause(0.2)
        self.assertEqual([h.language for h in self.rec.heard], ["fr", "en"])
        await self.finish()

    async def test_interim_results_are_ignored(self):
        await self.start()
        self.streams[0].events.put_nowait(interim("en", "hel"))
        self.streams[0].events.put_nowait(interim("en", "hello there"))
        await pause(0.2)
        self.assertEqual(self.rec.heard, [])
        await self.finish()

    async def test_what_was_said_when_the_audio_ends_is_still_reported(self):
        await self.start()
        self.streams[0].events.put_nowait(final("en", "my heater stopped working"))
        await pause(0.01)
        await self.finish()
        self.assertEqual(len(self.rec.heard), 1)
        self.assertEqual(self.rec.failed, [])

    async def test_a_stream_that_dies_is_restarted_once_and_listening_continues(self):
        await self.start()
        self.streams[0].events.put_nowait(RuntimeError("socket closed"))
        await pause(0.2)
        self.assertEqual(len(self.streams), 2)
        self.assertTrue(self.streams[0].closed)
        self.streams[1].events.put_nowait(final("en", "can you speak english please"))
        await pause(0.2)
        self.assertEqual(len(self.rec.heard), 1)
        self.assertEqual(self.rec.failed, [])
        await self.finish()

    async def test_a_second_failure_gives_up_and_says_so_once(self):
        await self.start()
        self.streams[0].events.put_nowait(RuntimeError("one"))
        await pause(0.2)
        self.streams[1].events.put_nowait(RuntimeError("two"))
        await asyncio.wait_for(self.task, 2)
        self.assertEqual(len(self.rec.failed), 1)
        self.assertIn("RuntimeError", self.rec.failed[0])
        self.assertNotIn("two", self.rec.failed[0])

    async def test_a_stream_that_cannot_start_reports_it_and_stops(self):
        def broken():
            raise ConnectionError("no route")

        await self.start(make_stream=broken)
        await asyncio.wait_for(self.task, 2)
        self.assertEqual(self.rec.failed, ["could not start: ConnectionError"])

    async def test_a_bug_in_the_observer_does_not_stop_the_listener(self):
        await self.start()
        calls = []

        def flaky(heard):
            calls.append(heard)
            if len(calls) == 1:
                raise ValueError("bug")

        self.rec.on_heard = flaky
        # Rebuild with the flaky observer.
        self.task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await self.task
        self.frames = Frames()
        self.streams.clear()
        self.task = asyncio.create_task(
            listen(
                self.frames,
                make_stream=self.make_stream,
                on_heard=flaky,
                on_failed=self.rec.on_failed,
                gap_seconds=0.05,
                restart_delay=0.0,
            )
        )
        await pause()
        with self.assertLogs("agent-tradecatch-receptionist", level="ERROR"):
            self.streams[0].events.put_nowait(final("en", "first sentence here"))
            await pause(0.2)
        self.streams[0].events.put_nowait(final("fr", "deuxième phrase ici"))
        await pause(0.2)
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.rec.failed, [])
        await self.finish()

    async def test_cancelling_closes_the_stream_without_reporting_a_failure(self):
        await self.start()
        self.task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await self.task
        self.assertTrue(self.streams[0].closed)
        self.assertEqual(self.rec.failed, [])


if __name__ == "__main__":
    unittest.main()
