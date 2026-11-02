"""Caption files (SRT for LinkedIn / Meta / YouTube uploads, WebVTT for the website player) for the three ads.

    python captions.py            -> ../captions/TradeCatch_<ad>_<LANG>.srt / .vtt  (+ transcripts.json for the website copy)

Cue times are the exact moments the mixer placed each recorded voice line (build_ads.Ad.cues), so captions cannot drift
from the audio, and they are identical for the 9:16 and 4:5 versions (same timeline, same audio stream).  The ads carry no
burned-in subtitles; captions are shipped as separate sidecar files so each platform can show or hide them.

Display text differs from the spoken text in three places only: the brand is written TradeCatch (the French voice says
"Tréïd Catch"), the URL is written tradecatch.ca, and call speakers are labelled so it is clear the receptionist is an AI."""
import json, re, sys
from pathlib import Path
import config as C
import build_ads as B

OUT = C.ADS_DIR / "captions"
MAX_LINE = 42                         # characters per caption line (broadcast / LinkedIn guidance)
MAX_CUE = 6.5                         # seconds on screen for one cue, at most
MIN_CUE = 1.0
TARGET_CPS = 20.0                     # reading speed to aim for (characters per second)
MAX_HOLD = 1.2                        # a cue may stay up this long after the voice stops, if the next cue has not started

SPEAKER = {   # (lang, who) -> label put in front of in-call lines; narration is unlabelled
    ("en", "recep"): "AI receptionist:", ("en", "cust"): "Caller:",
    ("fr", "recep"): "Réceptionniste IA :", ("fr", "cust"): "Client :",
}
SOUND = {"en": {"[sighs]": "[sighs]"}, "fr": {"[sighs]": "[soupir]"}}

WORDS_PATH = C.ASSETS / "voice" / "words.json"           # from gen_words.py (speech-to-text on each isolated line)
WORDS = json.loads(WORDS_PATH.read_text(encoding="utf-8")) if WORDS_PATH.exists() else {}
LEAD = 0.08                                               # a continuation cue appears this much before its first word
_norm = lambda w: re.sub(r"[^\w]", "", w.lower())

def piece_starts(lang, lid, t0, pieces):
    """Start time of each cue piece of one line. Piece 0 starts with the line; later pieces start at their first spoken
    word (found in the cached word timings near where the character count says it should be). None -> no word data."""
    ws = WORDS.get(f"{lang}/{lid}")
    if not ws: return None
    clean = [re.sub(r"\[[^\]]*\]", "", re.sub(r"^(AI receptionist|Caller|Réceptionniste IA|Client) ?:", "", p)).strip() for p in pieces]
    total = sum(len(c) + 1 for c in clean)
    cum, c = [], 0
    for w in ws: cum.append(c); c += len(w[0]) + 1
    starts, before = [t0], len(clean[0]) + 1
    for k in range(1, len(pieces)):
        frac = before / total
        e = min(range(len(ws)), key=lambda i: abs(cum[i] / c - frac))
        first = _norm(clean[k].split()[0]) if clean[k].split() else ""
        near = [i for i in range(max(0, e - 3), min(len(ws), e + 4)) if _norm(ws[i][0]) == first]
        i = min(near, key=lambda j: abs(j - e)) if near else e
        starts.append(max(t0 + ws[i][1] - LEAD, starts[-1] + 0.3))
        before += len(clean[k]) + 1
    return starts

def display_text(lang, lid, text):
    t = text.replace("Tréïd Catch", "TradeCatch")
    t = re.sub(r"trade ?catch (dot|point) C A", "tradecatch.ca", t, flags=re.I)
    for k, v in SOUND[lang].items(): t = t.replace(k, v)
    return t.replace("...", "…").strip()

def sentences(t):
    """Split at sentence ends, keeping a leading [sound label] attached to the sentence that follows it."""
    parts = [p.strip() for p in re.split(r"(?<=[.!?…])\s+", t) if p.strip()]
    out = []
    for p in parts:
        if out and re.fullmatch(r"\[[^\]]+\]", out[-1]): out[-1] = f"{out[-1]} {p}"
        else: out.append(p)
    return out

def wrap(text):
    """At most two balanced lines of <= MAX_LINE characters (a third line is never produced; the cue is split first)."""
    if len(text) <= MAX_LINE: return [text]
    words = text.split(); best = None
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        if len(a) <= MAX_LINE and len(b) <= MAX_LINE:
            score = abs(len(a) - len(b)) - (14 if a[-1] in ".,!?…:;" else 0)    # prefer to break after punctuation
            if best is None or score < best[0]: best = (score, [a, b])
    return best[1] if best else None

def split_to_fit(text):
    """Return text pieces that each fit in two lines; falls back to splitting at commas / word boundaries."""
    if wrap(text): return [text]
    comma = [m.end() for m in re.finditer(r",\s", text)]
    mid = len(text) / 2
    cut = min(comma, key=lambda i: abs(i - mid)) if comma else None
    if cut is None:
        words = text.split(); k = len(words) // 2; return split_to_fit(" ".join(words[:k])) + split_to_fit(" ".join(words[k:]))
    return split_to_fit(text[:cut].strip()) + split_to_fit(text[cut:].strip())

def cues_for(ad, lang):
    """-> list of dict(start, end, lines[], text, who) for one built Ad."""
    out = []
    for lid, t0, t1, who in ad.cues:
        role, spoken = C.LINES[lang][lid]
        text = display_text(lang, lid, spoken)
        label = SPEAKER.get((lang, who))
        if label: text = f"{label} {text}"                       # label goes in before splitting so line-fit counts it
        pieces = []
        for s in sentences(text):
            pieces += split_to_fit(s)
        # one cue per sentence, except that a piece which would flash by (< 1.4 s of its share of the line) is joined
        # to its neighbour when the two still fit on two lines
        dur = t1 - t0; tot = sum(len(p) for p in pieces)
        share_of = lambda s: dur * len(s) / tot
        merged = []
        for p in pieces:
            if merged and wrap(merged[-1] + " " + p) and (share_of(merged[-1]) < 1.4 or share_of(p) < 1.4):
                merged[-1] += " " + p
            else: merged.append(p)
        anchors = piece_starts(lang, lid, t0, merged)
        total_chars = sum(len(p) for p in merged); at = t0
        for i, p in enumerate(merged):
            if anchors:
                at = anchors[i]; e = anchors[i + 1] - 0.04 if i + 1 < len(merged) else t1
            else:                                                # no word data: split the line's time by character count
                e = t1 if i == len(merged) - 1 else at + dur * len(p) / total_chars
            lines = wrap(p)
            if not lines: raise ValueError(f"caption does not fit two lines of {MAX_LINE}: {p!r}")
            out.append(dict(start=at, end=e, lines=lines, who=who))
            if not anchors: at = e
    # readable and legal: hold a flash-short cue a little longer, cap very long ones, and never overlap the next cue
    # (the caller's sigh is deliberately layered over the tail of the narration)
    for i, c in enumerate(out):
        nxt = out[i + 1]["start"] if i + 1 < len(out) else c["end"] + 5
        chars = sum(len(x) for x in c["lines"]) + len(c["lines"]) - 1
        need = c["start"] + chars / TARGET_CPS                   # reading time at ~20 characters/second
        c["end"] = max(c["end"], c["start"] + MIN_CUE, min(need, c["end"] + MAX_HOLD))
        c["end"] = min(c["end"], c["start"] + MAX_CUE, nxt - 0.04)
        if c["end"] - c["start"] < 0.4: raise ValueError(f"cue too short after de-overlap: {c}")
    return out

def ts(sec, comma):
    ms = int(round(sec * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{',' if comma else '.'}{ms:03d}"

def srt(cues):
    return "".join(f"{i}\n{ts(c['start'], True)} --> {ts(c['end'], True)}\n" + "\n".join(c["lines"]) + "\n\n" for i, c in enumerate(cues, 1))

def vtt(cues):
    return "WEBVTT\n\n" + "".join(f"{ts(c['start'], False)} --> {ts(c['end'], False)}\n" + "\n".join(c["lines"]) + "\n\n" for c in cues)

def transcript(cues):
    """Plain running transcript (one paragraph per speaker turn) for the website copy."""
    out = []
    for c in cues:
        t = " ".join(c["lines"])
        if out and out[-1][0] == c["who"] and not re.match(r"^(AI receptionist|Caller|Réceptionniste IA|Client) ?:", t): out[-1][1] += " " + t
        else: out.append([c["who"], t])
    return " ".join(x[1] for x in out)

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True); meta = {}
    for key in ("A", "B", "C"):
        for lang in ("en", "fr"):
            ad = B.BUILDERS[key][0](lang)                        # plans the timeline only (no render)
            cues = cues_for(ad, lang)
            base = f"TradeCatch_{ad.key}_{lang.upper()}"
            (OUT / f"{base}.srt").write_text(srt(cues), encoding="utf-8")
            (OUT / f"{base}.vtt").write_text(vtt(cues), encoding="utf-8")
            meta[base] = dict(seconds=round(ad.t, 3), cues=len(cues), transcript=transcript(cues))
            print(f"{base}: {len(cues)} cues, {ad.t:.2f}s")
    (OUT / "transcripts.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
