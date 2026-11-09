"""Listens to the caller's audio for one thing: which language is being spoken.

The realtime voice model hears the call but does not say what language it heard,
so a second, text-only speech-to-text stream (Deepgram nova-3 in its multilingual
mode, through LiveKit Inference) runs beside it. This module groups that stream's
short final transcripts into utterances and reports each as a language.Heard:
language code, word count, confidence. The words themselves are counted and then
dropped: they are never stored, logged or sent anywhere else.

Nothing here can end or delay a call. If the stream cannot start or keeps
failing, `on_failed` is called once and the call carries on in its current
language (see language.CallLanguage.fail).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any, AsyncIterable, Awaitable, Callable

from language import Heard

logger = logging.getLogger("agent-tradecatch-receptionist")

DEFAULT_STT = "deepgram/nova-3"
# "multi" lets the recogniser follow a caller across French and English.
STT_LANGUAGE = "multi"
# Final transcripts that arrive closer together than this belong to one utterance.
UTTERANCE_GAP_SECONDS = 1.0
# A stream that dies is restarted this many times before detection is given up.
MAX_RESTARTS = 1
RESTART_DELAY_SECONDS = 0.5


class UtteranceGrouper:
    """Merges final transcripts into utterances: dominant language, total words, mean confidence."""

    def __init__(self) -> None:
        self._parts: list[tuple[str | None, int, float | None]] = []

    def add(self, language: str | None, text: str, confidence: float | None) -> None:
        words = len(text.split())
        if words:
            self._parts.append((language, words, confidence))

    def __bool__(self) -> bool:
        return bool(self._parts)

    def take(self) -> Heard | None:
        parts, self._parts = self._parts, []
        if not parts:
            return None
        weight: dict[str | None, int] = {}
        for language, words, _ in parts:
            weight[language] = weight.get(language, 0) + words
        language = max(weight, key=lambda key: weight[key])
        total = sum(words for _, words, _ in parts)
        scored = [(words, c) for _, words, c in parts if c is not None and c > 0]
        confidence = (
            sum(words * c for words, c in scored) / sum(words for words, _ in scored)
            if scored
            else None
        )
        return Heard(language=language, words=total, confidence=confidence)


async def listen(
    frames: AsyncIterable[Any],
    *,
    make_stream: Callable[[], Any],
    on_heard: Callable[[Heard], None],
    on_failed: Callable[[str], None],
    gap_seconds: float = UTTERANCE_GAP_SECONDS,
    max_restarts: int = MAX_RESTARTS,
    restart_delay: float = RESTART_DELAY_SECONDS,
) -> None:
    """Feed the caller's audio frames to a speech-to-text stream and report utterances.

    `make_stream()` returns an object with push_frame(), end_input(), aclose() and
    async iteration over events whose .type is a SpeechEventType (the LiveKit
    SpeechStream). Runs until the audio ends or the task is cancelled.
    """
    # Frames are read once and handed to whichever stream is current, so a restart
    # resumes with live audio instead of replaying what was already heard.
    current: dict[str, Any] = {"stream": None}
    restarts = 0
    done = asyncio.Event()

    async def pump() -> None:
        try:
            async for frame in frames:
                stream = current["stream"]
                if stream is not None:
                    with contextlib.suppress(Exception):
                        stream.push_frame(getattr(frame, "frame", frame))
        finally:
            done.set()
            stream = current["stream"]
            if stream is not None:
                with contextlib.suppress(Exception):
                    stream.end_input()

    pump_task = asyncio.create_task(pump())
    try:
        while True:
            try:
                stream = make_stream()
            except Exception as err:  # noqa: BLE001 - nothing may stop the call
                on_failed(f"could not start: {type(err).__name__}")
                return
            current["stream"] = stream
            try:
                await _read_events(stream, on_heard, gap_seconds)
                if done.is_set():
                    return
                raise RuntimeError("stream ended while the call was still going")
            except asyncio.CancelledError:
                raise
            except Exception as err:  # noqa: BLE001
                restarts += 1
                if restarts > max_restarts:
                    on_failed(f"stopped: {type(err).__name__}")
                    return
                logger.warning("language listener restarting (%s)", type(err).__name__)
                await asyncio.sleep(restart_delay)
            finally:
                current["stream"] = None
                with contextlib.suppress(Exception):
                    await stream.aclose()
    finally:
        pump_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await pump_task


async def _read_events(
    stream: Any, on_heard: Callable[[Heard], None], gap_seconds: float
) -> None:
    grouper = UtteranceGrouper()
    iterator = stream.__aiter__()
    pending: asyncio.Task[Any] | None = None
    try:
        while True:
            if pending is None:
                pending = asyncio.ensure_future(iterator.__anext__())
            # With a partial utterance waiting, a quiet gap closes it.
            timeout = gap_seconds if grouper else None
            done, _ = await asyncio.wait({pending}, timeout=timeout)
            if not done:
                _flush(grouper, on_heard)
                continue
            task, pending = pending, None
            try:
                event = task.result()
            except StopAsyncIteration:
                _flush(grouper, on_heard)
                return
            if _is_final(event) and event.alternatives:
                best = event.alternatives[0]
                grouper.add(
                    str(best.language) if best.language else None,
                    best.text or "",
                    getattr(best, "confidence", None),
                )
    finally:
        if pending is not None:
            pending.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await pending


def _is_final(event: Any) -> bool:
    kind = getattr(event, "type", None)
    return getattr(kind, "value", kind) == "final_transcript"


def _flush(grouper: UtteranceGrouper, on_heard: Callable[[Heard], None]) -> None:
    heard = grouper.take()
    if heard is None:
        return
    try:
        on_heard(heard)
    except Exception:  # noqa: BLE001 - a bug in the callback must not kill the stream
        logger.exception("language observation failed")


def start_listener(
    *,
    participant: Any,
    on_heard: Callable[[Heard], None],
    on_failed: Callable[[str], None],
    environ: Any,
    spawn: Callable[[Awaitable[Any]], Any],
) -> Any | None:
    """Start listening to a SIP participant's microphone. Returns the task, or None if it cannot start."""
    try:
        from livekit import rtc
        from livekit.agents import inference

        model = (environ.get("AGENT_LANGUAGE_STT") or "").strip() or DEFAULT_STT
        stt = inference.STT(
            model,
            language=STT_LANGUAGE,
            extra_kwargs={"interim_results": False, "endpointing": 400},
        )
        audio = rtc.AudioStream.from_participant(
            participant=participant,
            track_source=rtc.TrackSource.SOURCE_MICROPHONE,
            sample_rate=16000,
            num_channels=1,
        )
    except Exception as err:  # noqa: BLE001
        on_failed(f"could not start: {type(err).__name__}")
        return None

    async def run() -> None:
        try:
            await listen(
                audio,
                make_stream=lambda: stt.stream(language=STT_LANGUAGE),
                on_heard=on_heard,
                on_failed=on_failed,
            )
        finally:
            with contextlib.suppress(Exception):
                await audio.aclose()
            with contextlib.suppress(Exception):
                await stt.aclose()

    return spawn(run())
