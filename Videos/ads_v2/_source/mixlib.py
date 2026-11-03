"""Audio assembly for the ads: buses, processing chains, synthesized sounds, ducking, mastering."""
import json, subprocess, re
import numpy as np
from pathlib import Path
import config as C
from audio_util import decode, write_wav, lufs, ff_filter, fade, SR, run, FF

rng = np.random.default_rng(7)
db = lambda x: 10 ** (x / 20)

# ------------------------------------------------------------------ asset loading
_cache = {}
def sfx(name):
    k = ("sfx", name)
    if k not in _cache: _cache[k] = decode(C.ASSETS / "sfx" / f"{name}.mp3")
    return _cache[k].copy()

def music(name):
    k = ("mus", name)
    if k not in _cache: _cache[k] = decode(C.ASSETS / "music" / f"{name}.mp3", mono=False)
    return _cache[k].copy()

def voice(lang, lid):
    k = ("voice", lang, lid)
    if k not in _cache: _cache[k] = decode(C.ASSETS / "voice" / lang / f"{lid}.wav")   # silence-trimmed
    return _cache[k].copy()

def to_stereo(a, pan=0.0):
    if a.ndim == 2: return a
    th = (pan + 1) * np.pi / 4
    return np.stack([a * np.cos(th), a * np.sin(th)], axis=1).astype(np.float32)

def normalize_to(a, target_lufs):
    L, _ = lufs(a)
    if L < -60: return a
    return (a * db(target_lufs - L)).astype(np.float32)

# ------------------------------------------------------------------ voice chains
NARR_AF = ("highpass=f=75,equalizer=f=240:t=q:w=1:g=-1.5,equalizer=f=3400:t=q:w=1:g=2.2,"
           "acompressor=threshold=-22dB:ratio=2.4:attack=8:release=140:makeup=2")
CALL_AF = ("highpass=f=290,lowpass=f=3500,equalizer=f=1700:t=q:w=1.2:g=3.5,"
           "acompressor=threshold=-24dB:ratio=3.2:attack=4:release=70:makeup=3")
FAR_AF = "highpass=f=330,lowpass=f=1900,equalizer=f=900:t=q:w=1:g=2"          # call heard from another room
ROOM_AF = "highpass=f=95,equalizer=f=2600:t=q:w=1:g=1.5,aecho=0.85:0.75:35|60:0.10|0.05"  # a person in a small room

def proc_narr(a):  return normalize_to(ff_filter(a, NARR_AF), -19.0)
def proc_call(a):  return normalize_to(ff_filter(a, CALL_AF), -20.0)
def proc_far(a):   return normalize_to(ff_filter(a, FAR_AF), -27.0)
def proc_room(a):  return normalize_to(ff_filter(a, ROOM_AF), -21.0)

# ------------------------------------------------------------------ synthesized sounds
def ringback(ring_windows, total, level_db=-24):
    """North-American ringback: 440 + 480 Hz. ring_windows: [(start, end)] in seconds."""
    n = int(total * SR); t = np.arange(n) / SR
    tone = (np.sin(2 * np.pi * 440 * t) + np.sin(2 * np.pi * 480 * t)) * 0.5
    env = np.zeros(n)
    for a, b in ring_windows:
        i, j = int(a * SR), min(n, int(b * SR))
        seg = np.ones(j - i); r = int(0.012 * SR)
        seg[:r] = np.linspace(0, 1, r); seg[-r:] = np.linspace(1, 0, r); env[i:j] = seg
    return (ff_filter((tone * env).astype(np.float32), "highpass=f=300,lowpass=f=3400") * db(level_db)).astype(np.float32)

def key_click(level=1.0):
    n = int(0.012 * SR); x = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.0022 * SR))
    x = ff_filter(x.astype(np.float32), "highpass=f=1800,lowpass=f=7500")
    return (x * level).astype(np.float32)

def typing_track(start, end, n_chars, total, level_db=-31):
    out = np.zeros(int(total * SR), dtype=np.float32)
    times = np.linspace(start, end, n_chars, endpoint=False) + rng.uniform(-0.012, 0.012, n_chars)
    for tt in times:
        c = key_click(rng.uniform(.6, 1.0)); i = int(tt * SR)
        if 0 <= i < len(out) - len(c): out[i:i + len(c)] += c
    return out * db(level_db) * 8

def room_tone(dur, kind="day"):
    """Soft residential room tone: low-passed pink-ish noise + faint fridge hum."""
    n = int(dur * SR)
    w = rng.standard_normal(n).astype(np.float32)
    pink = ff_filter(w, "lowpass=f=1200,highpass=f=45,equalizer=f=250:t=q:w=0.8:g=3,equalizer=f=700:t=q:w=1:g=-3")
    t = np.arange(n) / SR
    hum = 0.35 * np.sin(2 * np.pi * 100 * t) + 0.18 * np.sin(2 * np.pi * 200 * t + 1.1) + 0.08 * np.sin(2 * np.pi * 300 * t)
    breathe = 0.85 + 0.15 * np.sin(2 * np.pi * 0.11 * t + 0.7)
    x = (pink * 0.9 + hum * 0.05) * breathe
    if kind == "night":
        x = x * 0.8 + (ff_filter(rng.standard_normal(n).astype(np.float32), "highpass=f=3800,lowpass=f=6200") * 0.012 *
                       (0.5 + 0.5 * np.sin(2 * np.pi * 0.23 * t) ** 8))      # faint distant insects
    x = x.astype(np.float32)
    return normalize_to(x, -44.0)

def detect_pulses(a, thresh=0.28, min_len=0.04, merge=0.06):
    """Return [(start, end)] seconds of loud bursts (vibration buzzes) in a mono sample."""
    hop = int(0.005 * SR); n = len(a) // hop
    e = np.array([np.sqrt(np.mean(a[i * hop:(i + 1) * hop] ** 2)) for i in range(n)])
    if e.max() <= 0: return []
    on = e > thresh * e.max(); segs = []; i = 0
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]: j += 1
            segs.append([i * hop / SR, j * hop / SR]); i = j
        else: i += 1
    merged = []
    for s in segs:
        if merged and s[0] - merged[-1][1] < merge: merged[-1][1] = s[1]
        else: merged.append(s)
    return [(round(a_, 3), round(b_, 3)) for a_, b_ in merged if b_ - a_ >= min_len]

# ------------------------------------------------------------------ the mixer
class Mix:
    BUSES = ("vo", "call", "far", "sfx", "amb", "music")
    def __init__(self, dur):
        self.dur = dur; self.n = int(dur * SR)
        self.b = {k: np.zeros((self.n, 2), dtype=np.float32) for k in self.BUSES}
        self.vo_events = []      # (start, end) of speech, for ducking + UI envelopes
        self.cut_windows = []    # windows during which call audio is heard "from another room"
        self.env_src = {"recep": [], "cust": []}

    def place(self, bus, a, t, gain_db=0.0, pan=0.0, fin=0.0, fout=0.0):
        a = to_stereo(np.asarray(a, dtype=np.float32), pan) * db(gain_db)
        if fin or fout: a = fade(a, fin, fout)
        i = int(round(t * SR)); j = i + len(a)
        if i < 0: a = a[-i:]; i = 0; j = i + len(a)
        if j > self.n: a = a[:self.n - i]; j = self.n
        if len(a): self.b[bus][i:j] += a

    def speech(self, who, a_mono, t, kind):
        """kind: narr | call | room.  who: narr | recep | cust (for UI envelopes)."""
        d = len(a_mono) / SR
        if kind == "narr":
            self.place("vo", proc_narr(a_mono), t)
            self.vo_events.append((t, t + d))
        elif kind == "call":
            self.place("call", proc_call(a_mono), t); self.place("far", proc_far(a_mono), t)
            self.vo_events.append((t, t + d)); self.env_src[who].append((t, a_mono))
        elif kind == "room":
            self.place("call", proc_room(a_mono), t); self.place("far", proc_far(a_mono), t, 2)
            self.vo_events.append((t, t + d)); self.env_src[who].append((t, a_mono))
        return d

    def envelope(self, who, t0, dur, fps=C.FPS * 2):
        """Speech energy (0..1) of recep/cust in [t0, t0+dur] at `fps`, from the real audio (for the live waveform UI)."""
        n = int(dur * fps); out = np.zeros(n)
        for (ts, a) in self.env_src[who]:
            hop = SR / fps
            for k in range(n):
                tt = t0 + k / fps
                if tt < ts or tt > ts + len(a) / SR: continue
                i = int((tt - ts) * SR); w = a[max(0, i - int(hop)):i + int(hop)]
                if len(w): out[k] = max(out[k], float(np.sqrt(np.mean(w ** 2))))
        out = out / (np.percentile(out[out > 0], 92) if (out > 0).any() else 1)
        # light smoothing
        k = np.array([.25, .5, .25]); out = np.convolve(out, k, mode="same")
        return np.clip(out, 0, 1).round(3).tolist()

    def _mask(self, windows, fade_s=0.09):
        m = np.zeros(self.n, dtype=np.float32)
        for a, b in windows:
            i, j = int(a * SR), min(self.n, int(b * SR)); m[i:j] = 1
        k = int(fade_s * SR); ker = np.hanning(k * 2 + 1); ker /= ker.sum()
        return np.convolve(m, ker, mode="same").astype(np.float32)

    def _duck(self, depth_db=-8.5, attack=0.07, release=0.55):
        act = np.zeros(self.n, dtype=np.float32)
        for a, b in self.vo_events:
            act[int(max(0, a - 0.05) * SR):min(self.n, int((b + 0.1) * SR))] = 1
        # first-order smoothing with different attack / release
        hop = 480; m = self.n // hop + 1
        a_ = act[::hop]; g = np.zeros(len(a_)); cur = 0.0
        ka = 1 - np.exp(-hop / (attack * SR)); kr = 1 - np.exp(-hop / (release * SR))
        for i, tgt in enumerate(a_):
            cur += (ka if tgt > cur else kr) * (tgt - cur); g[i] = cur
        g = np.interp(np.arange(self.n), np.arange(len(g)) * hop, g)
        return db(depth_db * g).astype(np.float32)

    def render(self, music_gain_db=-12.0, amb_gain_db=0.0, call_gain_db=0.0, vo_gain_db=0.0, duck_db=-8.5):
        cut = self._mask(self.cut_windows)[:, None]
        call = self.b["call"] * (1 - cut) * db(call_gain_db) + self.b["far"] * cut * 1.0
        duck = self._duck(duck_db)[:, None]
        out = (self.b["vo"] * db(vo_gain_db) + call + self.b["sfx"] + self.b["amb"] * db(amb_gain_db) +
               self.b["music"] * db(music_gain_db) * duck)
        return out.astype(np.float32)

def master(stereo, target_lufs=-14.0, tp=-1.5):
    """Two-pass EBU R128 loudnorm (linear) + safety limiter. Returns float stereo array and the measured stats."""
    tmp_in = C.WORK / "_master_in.wav"; tmp_out = C.WORK / "_master_out.wav"
    C.WORK.mkdir(parents=True, exist_ok=True)
    write_wav(tmp_in, stereo)
    r = subprocess.run([FF, "-hide_banner", "-i", str(tmp_in), "-af",
                        f"loudnorm=I={target_lufs}:TP={tp}:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    j = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.S).group(0))
    af = (f"loudnorm=I={target_lufs}:TP={tp}:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:"
          f"measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true,"
          f"alimiter=limit={db(tp):.4f}:level=disabled")
    run([FF, "-v", "error", "-y", "-i", str(tmp_in), "-af", af, "-ar", str(SR), str(tmp_out)])
    out = decode(tmp_out, mono=False)
    return out, j
