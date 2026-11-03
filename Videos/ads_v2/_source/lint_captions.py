"""Lint the SRT files: no overlap, <= 2 lines of <= 42 characters, reading speed, and the last cue ends inside the video.
    python lint_captions.py [max_cps]"""
import glob, sys, json
import config as C
LIMIT = float(sys.argv[1]) if len(sys.argv) > 1 else 30.0
meta = json.loads((C.ADS_DIR / "captions" / "transcripts.json").read_text(encoding="utf-8"))
sec = lambda s: (lambda h, m, r: int(h) * 3600 + int(m) * 60 + int(r.split(",")[0]) + int(r.split(",")[1]) / 1000)(*s.split(":"))
bad = 0; worst = 0
for f in sorted(glob.glob(str(C.ADS_DIR / "captions" / "*.srt"))):
    name = f.replace("\\", "/").split("/")[-1][:-4]; prev = -1; end = 0
    for b in open(f, encoding="utf-8").read().strip().split("\n\n"):
        l = b.split("\n"); a, e = [sec(x) for x in l[1].split(" --> ")]; text = l[2:]
        cps = (sum(len(x) for x in text) + len(text) - 1) / (e - a); worst = max(worst, cps)
        pr = [n for n, c in (("overlap", a < prev), ("long line", max(map(len, text)) > 42), ("3+ lines", len(text) > 2), (f"cps {cps:.1f}", cps > LIMIT)) if c]
        if pr: bad += 1; print(name, l[0], pr, " / ".join(text))
        prev = e; end = e
    if end > meta[name]["seconds"]: bad += 1; print(name, "last cue ends after the video", end, meta[name]["seconds"])
print(f"problem cues: {bad}   fastest cue: {worst:.1f} characters/second")
