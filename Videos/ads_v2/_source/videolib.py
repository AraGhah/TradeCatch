"""Video segment builders: graded footage (push-in + handheld + grain), UI scenes (rendered frames), concat, mux."""
import hashlib, json, shutil, subprocess, os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import config as C
from audio_util import run, FF

FPS = C.FPS
def frames(sec): return max(1, round(sec * FPS))
def q(sec): return frames(sec) / FPS            # quantize seconds to whole frames

# footage source clips (720x1280, 24 fps, AI-generated stills-to-video; silent)
CLIPS = {
    "p_before": C.VIDEOS / "01_plombier_AVANT_appel_manque.mp4",
    "p_after":  C.VIDEOS / "02_plombier_APRES_receptionist.mp4",
    "p_night":  C.VIDEOS / "03_plombier_APRES_HEURES.mp4",
    "e_before": C.VIDEOS / "04_electricien_AVANT_appel_manque.mp4",
    "e_after":  C.VIDEOS / "05_electricien_APRES_receptionist.mp4",
}

GRADES = {
    # gentle, natural: slightly lower saturation, soft S-curve, warm highlights / cool shadows, real grain
    "day":   "eq=contrast=1.06:saturation=0.90:brightness=-0.012,colorbalance=rs=-0.010:bs=0.012:rh=0.030:bh=-0.028,"
             "curves=all='0/0 0.10/0.085 0.5/0.5 0.9/0.915 1/0.99'",
    "night": "eq=contrast=1.09:saturation=0.98:brightness=-0.015,colorbalance=rs=-0.012:bs=0.030:rh=0.045:bh=-0.050,"
             "curves=all='0/0.005 0.12/0.10 0.5/0.49 0.9/0.92 1/0.99'",
    "ladder": "eq=contrast=1.05:saturation=0.88:brightness=-0.010,colorbalance=rs=-0.008:bs=0.014:rh=0.020:bh=-0.020,"
              "curves=all='0/0 0.10/0.085 0.5/0.5 0.9/0.915 1/0.985'",
}

def footage_segment(out, clip, t_in, dur, zoom=(1.08, 1.14), anchor=(0.5, 0.5), grade="day", speed=1.0, seed=0, grain=7, a45=None):
    """Cut `dur` seconds (output time) of `clip` starting at source time t_in; upscale 720p -> 1080x1920 with a slow push-in
    (zoom z0->z1 about `anchor`), subtle handheld drift, temporal denoise (removes generative shimmer), light sharpening,
    grade, vignette and real film grain.
    Output size follows config.W x config.H.  The picture is always scaled as for 1080x1920 (so the look and the push-in
    are identical across formats); a shorter frame (4:5) simply crops a window out of it, placed by `a45` = (x, y) in 0..1
    (0 = top/left, 1 = bottom/right of the available slack) instead of `anchor`. A 3-tuple (x, y_from, y_to) tilts the
    window from y_from to y_to over the shot (used to follow the story: face -> phone)."""
    OW, OH = C.W, C.H
    if (OW, OH) != (1080, 1920) and a45 is not None: anchor = a45
    nf = frames(dur); d = nf / FPS; z0, z1 = zoom; ax, ay = anchor[0], anchor[1]
    ay_expr = f"{ay}"
    if len(anchor) == 3:     # (x, y_from, y_to): a slow handheld tilt, eased, over the middle of the shot (4:5 only)
        u = f"clip((t-{0.12 * d:.3f})/{0.73 * d:.3f},0,1)"
        ay_expr = f"({anchor[1]}+({anchor[2]}-{anchor[1]})*{u}*{u}*(3-2*{u}))"
    ph = [(seed * 1.7 + k * 2.1) % 6.283 for k in range(4)]
    Z = f"({z0}+({z1}-{z0})*t/{d:.4f})"
    sx = f"4.2*sin(2*PI*0.37*t+{ph[0]:.3f})+1.9*sin(2*PI*1.10*t+{ph[1]:.3f})"
    sy = f"3.4*sin(2*PI*0.29*t+{ph[2]:.3f})+1.5*sin(2*PI*0.93*t+{ph[3]:.3f})"
    vf = (f"setpts=(PTS-STARTPTS)/{speed},fps={FPS},hqdn3d=1.6:1.3:4.5:3.5,"
          f"scale=w='trunc(1080*{Z}/2)*2':h='trunc(1920*{Z}/2)*2':eval=frame:flags=lanczos,"
          f"crop={OW}:{OH}:x='(iw-{OW})*{ax}+{sx}':y='(ih-{OH})*{ay_expr}+{sy}',"
          f"unsharp=5:5:0.55:5:5:0.0,{GRADES[grade]},vignette=PI/5.2,"
          f"noise=alls={grain}:allf=t+u,format=yuv420p")
    cmd = [FF, "-v", "error", "-y", "-ss", f"{t_in:.4f}", "-t", f"{d * speed + 0.2:.4f}", "-i", str(CLIPS[clip]), "-an", "-vf", vf,
           "-frames:v", str(nf), "-r", str(FPS), "-c:v", "libx264", "-preset", "fast", "-crf", "12", "-pix_fmt", "yuv420p", str(out)]
    run(cmd); return out

# ----------------------------------------------------------------------------- UI scenes
def _node_render(spec_path, out_dir, rng_list):
    r = subprocess.run(["node", str(C.ROOT / "ui" / "render_ui.mjs"), str(spec_path), str(out_dir), rng_list], capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(r.stderr[-800:] or r.stdout[-800:])

def with_format(spec):
    """Stamp the active output size into a UI spec (ui.html lays itself out for 1080x1920 or 1080x1350)."""
    return dict(spec, w=C.W, h=C.H)

def render_ui_scene(spec, workers=6, force=False):
    """Render a UI scene to an mp4 (cached by spec hash). Returns the mp4 path."""
    spec = with_format(spec)
    key =hashlib.sha1(json.dumps(spec, sort_keys=True, ensure_ascii=False).encode() + (C.ROOT / "ui" / "ui.html").read_bytes()).hexdigest()[:14]
    cdir = C.WORK / "ui_cache"; cdir.mkdir(parents=True, exist_ok=True)
    mp4 = cdir / f"{spec['type']}_{key}.mp4"
    if mp4.exists() and not force: return mp4
    fdir = cdir / f"frames_{key}"; shutil.rmtree(fdir, ignore_errors=True); fdir.mkdir()
    sp = cdir / f"spec_{key}.json"; sp.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    n = frames(spec["dur"]); per = -(-n // workers)
    chunks = [f"{a}-{min(n - 1, a + per - 1)}" for a in range(0, n, per)]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(lambda c: _node_render(sp, fdir, c), chunks))
    got = len(list(fdir.glob("f*.jpg")))
    if got != n: raise RuntimeError(f"UI render produced {got}/{n} frames")
    run([FF, "-v", "error", "-y", "-framerate", str(FPS), "-i", str(fdir / "f%05d.jpg"), "-c:v", "libx264", "-preset", "fast",
         "-crf", "12", "-pix_fmt", "yuv420p", "-r", str(FPS), str(mp4)])
    shutil.rmtree(fdir, ignore_errors=True)
    return mp4

def cut_range(src, out, a, dur):
    """Exact frame-aligned cut from an intermediate mp4 (re-encoded at crf 12)."""
    nf = frames(dur); start = round(a * FPS) / FPS
    run([FF, "-v", "error", "-y", "-ss", f"{start:.5f}", "-i", str(src), "-frames:v", str(nf), "-an", "-r", str(FPS),
         "-c:v", "libx264", "-preset", "fast", "-crf", "12", "-pix_fmt", "yuv420p", str(out)])
    return out

def concat(segs, out):
    lst = Path(str(out) + ".txt"); lst.write_text("".join(f"file '{Path(s).as_posix()}'\n" for s in segs), encoding="utf-8")
    run([FF, "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)])
    return out

def mux(video, audio_wav, out, crf=15):
    """Final platform encode: H.264 High, yuv420p, 24 fps, AAC 256k @ 48 kHz, faststart."""
    run([FF, "-v", "error", "-y", "-i", str(video), "-i", str(audio_wav), "-map", "0:v:0", "-map", "1:a:0",
         "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p",
         "-maxrate", "14M", "-bufsize", "28M", "-g", "48", "-bf", "2", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
         "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", str(out)])
    return out

def duration(path):
    r = run([FF.replace("ffmpeg", "ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    return float(r.stdout.strip())

def mux_copy_audio(video, audio_src, out, crf=15):
    """Same platform encode as mux(), but the audio stream is copied (not re-encoded) from an existing master."""
    run([FF, "-v", "error", "-y", "-i", str(video), "-i", str(audio_src), "-map", "0:v:0", "-map", "1:a:0",
         "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p",
         "-maxrate", "14M", "-bufsize", "28M", "-g", "48", "-bf", "2", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
         "-c:a", "copy", "-shortest", "-movflags", "+faststart", str(out)])
    return out
