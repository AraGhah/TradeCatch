"""Generate three instrumental beds + brand sting with ElevenLabs Music (cached). Usage: python gen_music.py [--force] [id ...]"""
import sys, json
import el, config as C
from audio_util import decode, write_wav, lufs, SR
MUSIC = {
 "bed_A": ("Warm, confident modern commercial underscore for a trades-business ad. Fingerpicked acoustic guitar, soft kick, brushed percussion, round bass and a light analog synth pad. Starts sparse and slightly tense for the first 14 seconds, then lifts into a steady optimistic groove, and resolves on a clean final chord at about 52 seconds. Instrumental, no vocals, no spoken words.", 54000),
 "bed_B": ("Clean, upbeat, modern commercial underscore. Plucked electric guitar, tight claps, warm bass and a bright but restrained synth. Begins with a subtle pulse, builds into a confident, friendly groove, ends on a clean final hit at about 32 seconds. Instrumental, no vocals, no spoken words.", 32000),
 "bed_C": ("Cinematic nighttime underscore. Low sustained cello and soft synth pad, a quiet heartbeat-like pulse and sparse piano. Builds tension for about 18 seconds, then resolves into calm, reassuring warm pads and gentle piano, ending softly at about 36 seconds. Instrumental, no vocals, no spoken words.", 36000),
 "sting":  ("A short warm confident brand sting: two plucked guitar notes and a soft synth chord that rings out and fades. Instrumental, no vocals.", 4000),
}
force = "--force" in sys.argv
only = [a for a in sys.argv[1:] if not a.startswith("--")]
d = C.ASSETS / "music"; d.mkdir(parents=True, exist_ok=True)
meta_path = d / "timing.json"
meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
for mid, (prompt, ms) in MUSIC.items():
    if only and mid not in only: continue
    mp3 = d / f"{mid}.mp3"
    if mp3.exists() and not force and mid in meta: continue
    s, b, _ = el.call("/v1/music?output_format=mp3_44100_192", {"prompt": prompt, "music_length_ms": ms, "force_instrumental": True})
    if s != 200:
        # retry without the optional flag
        s, b, _ = el.call("/v1/music?output_format=mp3_44100_192", {"prompt": prompt, "music_length_ms": ms})
    if s != 200: print("FAIL", mid, s, b[:300]); continue
    mp3.write_bytes(b)
    a = decode(mp3, mono=False); write_wav(d / f"{mid}.wav", a)
    L, tp = lufs(a)
    meta[mid] = {"prompt": prompt, "dur": round(len(a)/SR, 3), "lufs": L, "tp": tp}
    print(f"{mid:8s} {len(a)/SR:6.2f}s {L:6.1f} LUFS tp {tp:5.1f}")
meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")
