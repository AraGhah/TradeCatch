"""ffmpeg/numpy audio helpers shared by the build scripts."""
import subprocess, json, re, wave, numpy as np
from pathlib import Path
SR = 48000
FF = "ffmpeg"

def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError(f"cmd failed: {' '.join(map(str,cmd))[:200]}\n{r.stderr[-800:]}")
    return r

def decode(path, mono=True, af=None):
    """Decode any audio file to float32 numpy at 48 kHz. Returns (n,) or (n,2)."""
    cmd = [FF, "-v", "error", "-i", str(path)]
    if af: cmd += ["-af", af]
    cmd += ["-ac", "1" if mono else "2", "-ar", str(SR), "-f", "f32le", "-"]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0: raise RuntimeError(r.stderr.decode()[-500:])
    a = np.frombuffer(r.stdout, dtype=np.float32)
    return a if mono else a.reshape(-1, 2)

def write_wav(path, a, sr=SR):
    a = np.asarray(a, dtype=np.float32)
    ch = 1 if a.ndim == 1 else a.shape[1]
    pcm = (np.clip(a, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(ch); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())

def lufs(a, sr=SR):
    """Integrated loudness (BS.1770 via ffmpeg ebur128). a: float32 numpy."""
    a = np.asarray(a, dtype=np.float32)
    ch = 1 if a.ndim == 1 else a.shape[1]
    r = subprocess.run([FF, "-hide_banner", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-",
                        "-af", "ebur128=peak=true", "-f", "null", "-"], input=a.tobytes(), capture_output=True)
    txt = r.stderr.decode(errors="ignore")
    m = re.findall(r"\n\s+I:\s+(-?[\d.]+) LUFS", txt)
    tp = re.findall(r"\n\s+Peak:\s+(-?[\d.]+) dBFS", txt)
    return (float(m[-1]) if m else -70.0), (float(tp[-1]) if tp else -70.0)

def trim_silence(a, thresh_db=-42, pad=0.06, sr=SR):
    thr = 10 ** (thresh_db / 20)
    idx = np.where(np.abs(a) > thr)[0]
    if len(idx) == 0: return a
    s = max(0, idx[0] - int(pad * sr)); e = min(len(a), idx[-1] + int(pad * sr))
    return a[s:e]

def ff_filter(a, af, sr=SR):
    """Run mono/stereo float array through an ffmpeg -af chain, return float array."""
    a = np.asarray(a, dtype=np.float32)
    ch = 1 if a.ndim == 1 else a.shape[1]
    r = subprocess.run([FF, "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-", "-af", af,
                        "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-"], input=a.tobytes(), capture_output=True)
    if r.returncode != 0: raise RuntimeError(r.stderr.decode()[-500:])
    o = np.frombuffer(r.stdout, dtype=np.float32)
    return o if ch == 1 else o.reshape(-1, ch)

def fade(a, fin=0.0, fout=0.0, sr=SR):
    a = a.copy()
    if fin > 0:
        n = min(len(a), int(fin * sr)); a[:n] *= np.linspace(0, 1, n, dtype=np.float32) if a.ndim == 1 else np.linspace(0, 1, n, dtype=np.float32)[:, None]
    if fout > 0:
        n = min(len(a), int(fout * sr)); a[-n:] *= np.linspace(1, 0, n, dtype=np.float32) if a.ndim == 1 else np.linspace(1, 0, n, dtype=np.float32)[:, None]
    return a
