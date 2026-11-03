"""Word timings for every recorded voice line (ElevenLabs speech-to-text on the trimmed wav the mixer uses), cached in
assets/voice/words.json as {"<lang>/<id>": [[word, start_s, end_s], ...]}, times relative to the start of that wav.
captions.py uses them to place the start of a second or third caption cue inside a long line exactly.
    python gen_words.py [--force]"""
import sys, json
import el, config as C
force = "--force" in sys.argv
path = C.ASSETS / "voice" / "words.json"
words = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
for lang in ("en", "fr"):
    for lid in C.LINES[lang]:
        k = f"{lang}/{lid}"
        if k in words and not force: continue
        res = el.stt(C.ASSETS / "voice" / lang / f"{lid}.wav", lang=lang)
        if "words" not in res: print("FAIL", k, str(res)[:160]); continue
        words[k] = [[w["text"], round(w["start"], 3), round(w["end"], 3)] for w in res["words"] if w.get("type") == "word"]
        print(k, len(words[k]), "words")
path.write_text(json.dumps(words, ensure_ascii=False, indent=0), encoding="utf-8")
