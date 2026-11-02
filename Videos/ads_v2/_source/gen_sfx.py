"""Generate the Foley / ambience / UI sound library with ElevenLabs sound-generation (cached).
Usage: python gen_sfx.py [--force] [id ...]"""
import sys, json
import el, config as C
from audio_util import decode, write_wav, lufs, SR
SFX = {
 # ambience (loopable beds, trimmed/looped in the mix)
 "amb_kitchen_day":   ("quiet residential kitchen room tone, faint refrigerator hum, very distant traffic outside, no voices, no music", 18),
 "amb_kitchen_night": ("quiet home kitchen at night, soft room tone, faint refrigerator hum, a few distant crickets outside, no voices, no music", 18),
 "amb_room_empty":    ("empty house interior room tone, quiet, soft air, faint distant traffic outside, no voices, no music", 18),
 "amb_water_flood":   ("water gushing and splashing steadily in a basement, urgent ambient flow, no voices, no music", 10),
 # Foley - plumber
 "wrench_work":       ("adjustable wrench turning a plumbing slip nut under a kitchen sink, slow metallic ratchet clicks and small scrapes, close, dry, no music", 8),
 "tool_clink":        ("a steel wrench set down on a tile floor, one short clink, close microphone", 2),
 "pipe_tap":          ("light metal tap on a PVC drain pipe, two soft taps, close", 2),
 "fabric_kneel":      ("work overalls fabric rustle as a man shifts his weight while kneeling on a tile floor, subtle, close", 4),
 "drip":              ("slow water drips falling into a stainless steel sink, quiet, three drips", 4),
 # Foley - electrician
 "ladder_creak":      ("aluminum step ladder creaking slightly as a person shifts weight, subtle metal creaks, quiet room", 5),
 "fixture_work":      ("a person twisting a metal ceiling light fixture, small metallic clinks and screws turning, close, quiet room", 7),
 # phone
 "phone_buzz_toolbox":("smartphone vibrating on a hard plastic toolbox, three strong buzzes, close", 3),
 "phone_buzz_tile":   ("smartphone vibrating on a tile floor, two buzzes, close", 2),
 "phone_ring_floor":  ("generic smartphone ringtone, soft electronic melody, two rings, slightly muffled as if the phone is lying on a floor in a kitchen", 5),
 "phone_pickup":      ("a hand picking up a smartphone from a plastic toolbox, small plastic scrape and grip", 1.5),
 # UI
 "sms_in":            ("soft smartphone text message notification, one short two-note chime, clean, dry", 1.5),
 "sms_sent":          ("smartphone message sent swoosh, very short soft whoosh", 1),
 "ui_tap":            ("soft touchscreen tap click, tiny, dry", 0.6),
 "notif_lead":        ("gentle positive app notification chime, three ascending soft notes, clean and modern, dry", 2),
 "call_connect":      ("telephone call connecting click and soft line open, subtle", 1.5),
 "call_end":          ("smartphone call ended, a short low double beep, dry", 1.2),
 # transitions / accents
 "whoosh_soft":       ("short soft cinematic whoosh transition, subtle, no music", 1.2),
 "whoosh_hit":        ("cinematic riser into a deep soft low impact hit, subtle and tasteful, no music", 2.5),
 "keys_truck":        ("car keys jingling and a pickup truck door closing, then an engine starting, outdoors at night", 6),
}
force = "--force" in sys.argv
only = [a for a in sys.argv[1:] if not a.startswith("--")]
d = C.ASSETS / "sfx"; d.mkdir(parents=True, exist_ok=True)
meta_path = d / "timing.json"
meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
for sid, (prompt, secs) in SFX.items():
    if only and sid not in only: continue
    mp3 = d / f"{sid}.mp3"
    if mp3.exists() and not force and sid in meta: continue
    s, r, _ = el.sfx(prompt, mp3, seconds=secs, influence=0.55)
    if s != 200: print("FAIL", sid, s, str(r)[:200]); continue
    a = decode(mp3); write_wav(d / f"{sid}.wav", a)
    L, tp = lufs(a)
    meta[sid] = {"prompt": prompt, "dur": round(len(a)/SR, 3), "lufs": L, "tp": tp}
    print(f"{sid:20s} {len(a)/SR:5.2f}s {L:6.1f} LUFS tp {tp:5.1f}")
meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")
