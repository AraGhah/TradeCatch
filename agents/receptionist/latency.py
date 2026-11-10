"""How long the caller waits for an answer, and where the time goes (pure, no LiveKit imports).

Each caller turn becomes one log line, with no caller words in it:

    reply gap 1.42s (2 backend runs) [end of turn 0.50s, speech-to-text 0.31s, model first
    token 0.40s, model total 0.90s, voice first audio 0.21s]

`gap` is what the caller feels: from the moment they stop talking to the first sound of the
answer. The bracketed stages are the pieces LiveKit reports for that turn; a stage the
pipeline in use does not report (a speech-to-speech model has no separate voice or
speech-to-text step) is left out rather than guessed.

At the end of the call one summary line is logged:

    reply latency summary: 12 turns, avg 1.10s, p50 0.90s, p95 3.20s, max 4.80s

To compare before and after a change, collect the logs of real calls (`lk agent logs`) and run

    python latency.py before.log after.log

which prints average, p50, p95 and max for each file.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

# (metric field, label) per LiveKit metrics type, in the order they are logged.
_STAGES: dict[str, tuple[str, str]] = {
    "eou_metrics": ("end_of_utterance_delay", "end of turn"),
    "stt_metrics": ("duration", "speech-to-text"),
    "realtime_model_metrics": ("ttft", "voice model first audio"),
    "tts_metrics": ("ttfb", "voice first audio"),
}


# The order the stages happen in a turn; logged in this order whatever order LiveKit reports them.
_ORDER = (
    "end of turn",
    "speech-to-text",
    "model first token",
    "model total",
    "voice model first audio",
    "voice first audio",
)


@dataclass
class TurnRecord:
    """One caller turn: the gap and the stages that were reported for it."""

    gap: float
    backend_runs: int = 0
    stages: dict[str, float] = field(default_factory=dict)

    def line(self) -> str:
        known = [label for label in _ORDER if label in self.stages]
        extra = [label for label in self.stages if label not in _ORDER]
        parts = [f"{label} {self.stages[label]:.2f}s" for label in known + extra]
        detail = f" [{', '.join(parts)}]" if parts else ""
        return f"reply gap {self.gap:.2f}s ({self.backend_runs} backend runs){detail}"


class TurnTimer:
    """Follows one caller turn at a time: stop talking -> first sound of the answer."""

    def __init__(self) -> None:
        self._stopped_at: float | None = None
        self._runs = 0
        self._stages: dict[str, float] = {}

    def caller_stopped(self, now: float) -> None:
        self._stopped_at = now
        self._runs = 0
        self._stages = {}

    def caller_spoke(self) -> None:
        """The caller started again: the pending turn is not over."""
        self._stopped_at = None

    @property
    def waiting(self) -> bool:
        return self._stopped_at is not None

    def add(self, metrics: Any) -> int | None:
        """Take one LiveKit metrics object. Returns the number of backend runs when it was one."""
        kind = getattr(metrics, "type", None)
        if kind == "llm_metrics":
            self._runs += 1
            ttft = _seconds(getattr(metrics, "ttft", None))
            if ttft is not None and "model first token" not in self._stages:
                self._stages["model first token"] = ttft
            total = _seconds(getattr(metrics, "duration", None))
            if total is not None:
                self._stages["model total"] = self._stages.get("model total", 0.0) + total
            return self._runs
        stage = _STAGES.get(kind or "")
        if stage:
            seconds = _seconds(getattr(metrics, stage[0], None))
            if seconds is not None:
                self._stages[stage[1]] = seconds
        return None

    def agent_spoke(self, now: float) -> TurnRecord | None:
        """The agent's first sound for the pending turn, or None when no turn is pending."""
        if self._stopped_at is None:
            return None
        record = TurnRecord(
            gap=max(0.0, now - self._stopped_at),
            backend_runs=self._runs,
            stages=dict(self._stages),
        )
        self._stopped_at = None
        return record


def _seconds(value: Any) -> float | None:
    """A non-negative duration in seconds, or None (LiveKit reports -1 when unknown)."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def percentile(values: Sequence[float], q: float) -> float:
    """The q-th percentile (0-100), linearly interpolated between the two nearest values."""
    if not values:
        raise ValueError("no values")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * (q / 100.0)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


@dataclass
class Summary:
    turns: int
    average: float
    p50: float
    p95: float
    maximum: float

    def line(self) -> str:
        return (
            f"reply latency summary: {self.turns} turns, avg {self.average:.2f}s, "
            f"p50 {self.p50:.2f}s, p95 {self.p95:.2f}s, max {self.maximum:.2f}s"
        )


def summarize(gaps: Iterable[float]) -> Summary | None:
    values = [g for g in gaps if g >= 0]
    if not values:
        return None
    return Summary(
        turns=len(values),
        average=sum(values) / len(values),
        p50=percentile(values, 50),
        p95=percentile(values, 95),
        maximum=max(values),
    )


class CallLatency:
    """All the turns of one call."""

    def __init__(self) -> None:
        self.gaps: list[float] = []

    def add(self, record: TurnRecord) -> None:
        self.gaps.append(record.gap)

    def summary(self) -> Summary | None:
        return summarize(self.gaps)


_GAP = re.compile(r"reply gap (\d+(?:\.\d+)?)s")


def gaps_in(lines: Iterable[str]) -> list[float]:
    """Every reply gap found in agent log lines (any prefix, any number of calls)."""
    found: list[float] = []
    for line in lines:
        match = _GAP.search(line)
        if match:
            found.append(float(match.group(1)))
    return found


def report(named: Sequence[tuple[str, Iterable[str]]]) -> str:
    """A small table: one row per log file."""
    rows = [("log", "turns", "avg", "p50", "p95", "max")]
    for name, lines in named:
        summary = summarize(gaps_in(lines))
        if summary is None:
            rows.append((name, "0", "-", "-", "-", "-"))
            continue
        rows.append(
            (
                name,
                str(summary.turns),
                f"{summary.average:.2f}s",
                f"{summary.p50:.2f}s",
                f"{summary.p95:.2f}s",
                f"{summary.maximum:.2f}s",
            )
        )
    widths = [max(len(row[i]) for row in rows) for i in range(len(rows[0]))]
    return "\n".join("  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)) for row in rows)


def main(argv: Sequence[str]) -> int:
    if len(argv) <= 1:
        print(report([("stdin", sys.stdin)]))
        return 0
    named: list[tuple[str, list[str]]] = []
    for path in argv[1:]:
        with open(path, encoding="utf-8", errors="replace") as handle:
            named.append((path, handle.read().splitlines()))
    print(report(named))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
