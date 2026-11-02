"""Generate every spoken line with ElevenLabs v3 (cached). Usage: python gen_voice.py [--force] [en|fr] [ID ...]"""
import sys, json, hashlib
import el, config as C
from audio_util import decode, trim_silence, write_wav, lufs, SR
force = "--force" in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith("--")]
langs = [a for a in args if a in ("en", "fr")] or ["en", "fr"]
only = [a for a in args if a not in ("en", "fr")]
out_meta = {}
meta_path = C.ASSETS / "voice" / "timing.json"
if meta_path.exists(): out_meta = json.loads(meta_path.read_text(encoding="utf-8"))
total_chars = 0
for lang in langs:
    d = C.ASSETS / "voice" / lang; d.mkdir(parents=True, exist_ok=True)
    for lid, (role, text) in C.LINES[lang].items():
        if only and lid not in only: continue
        key = hashlib.sha1(f"{lang}|{role}|{C.VOICES[lang][role]}|{C.STABILITY[role]}|{text}".encode()).hexdigest()[:12]
        mp3 = d / f"{lid}.mp3"
        m = out_meta.get(f"{lang}/{lid}", {})
        if mp3.exists() and m.get("key") == key and not force:
            continue
        s, r, _ = el.tts(C.VOICES[lang][role], text, mp3, model="eleven_v3", stability=C.STABILITY[role], similarity=0.8, lang=lang)
        if s != 200:
            print("FAIL", lang, lid, s, str(r)[:200]); continue
        total_chars += len(text)
        a = trim_silence(decode(mp3), thresh_db=-42, pad=0.05)
        wav = d / f"{lid}.wav"; write_wav(wav, a)
        L, tp = lufs(a)
        out_meta[f"{lang}/{lid}"] = {"key": key, "role": role, "dur": round(len(a) / SR, 3), "lufs": L, "tp": tp, "text": text}
        print(f"{lang}/{lid:7s} {role:6s} {len(a)/SR:5.2f}s  {L:6.1f} LUFS  tp {tp:5.1f}")
meta_path.write_text(json.dumps(out_meta, ensure_ascii=False, indent=1), encoding="utf-8")
print("chars generated this run:", total_chars)
