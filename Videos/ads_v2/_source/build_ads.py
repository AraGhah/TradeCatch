"""Build the TradeCatch ads.   python build_ads.py <A|B|C> <en|fr> [--no-render]

Every cut, sound, buzz and UI animation is derived from measured audio durations, so EN and FR versions
re-time themselves and picture/sound cannot drift.  All scenes are dramatizations with a fictional business."""
import sys, json, shutil, subprocess
from pathlib import Path
import numpy as np
import config as C, ui_specs as U, mixlib as M, videolib as V
from audio_util import SR, write_wav, lufs, decode, run, FF, ff_filter

OUTDIR = C.ADS_DIR

class Ad:
    def __init__(self, key, lang, max_dur=75):
        self.key, self.lang = key, lang
        self.mix = M.Mix(max_dur); self.items = []; self.t = 0.0
        self.work = C.WORK / (f"{key}_{lang}" if C.FMT == "9x16" else f"{key}_{lang}_{C.FMT}"); shutil.rmtree(self.work, ignore_errors=True); self.work.mkdir(parents=True)
        self.amb = []                                   # (t0, t1, gain_db, kind)
        self.notes = []; self.amb_kind = "day"
        self.cues = []                                  # spoken lines as placed in the mix: (line id, start s, end s, speaker)
    # ---- helpers
    def d(self, lid): return len(M.voice(self.lang, lid)) / SR
    def vo(self, lid, t, kind="narr", who="narr", gain_db=0.0):
        a = M.voice(self.lang, lid)
        if kind == "narr": self.mix.speech("narr", a, t, "narr")
        else: self.mix.speech(who, a, t, kind)
        self.cues.append((lid, round(t, 3), round(t + len(a) / SR, 3), "narr" if kind == "narr" else who))
        return t + len(a) / SR
    def sfx(self, name, t, gain_db=0.0, ref=-24.0, off=0.0, dur=None, fade=0.04, pan=0.0):
        a = M.sfx(name); a = a[int(off * SR):]
        if dur is not None: a = a[:int(dur * SR)]
        L, _ = lufs(a) if len(a) > SR // 2 else (None, None)
        if L is None or L < -60:
            rms = float(np.sqrt(np.mean(a ** 2)) + 1e-9); a = a * (M.db(ref + 3) / rms * 0.1)
        else: a = a * M.db(ref - L)
        self.mix.place("sfx", a, t, gain_db, pan, fin=fade, fout=fade)
    def footage(self, clip, t_in, dur, region_gain=0.0, **kw):
        s = self.t; dq = V.q(dur)
        self.items.append(dict(kind="f", clip=clip, t_in=t_in, dur=dq, kw=kw, start=s)); self.t += dq
        self.amb.append((s, s + dq, 0.0 + region_gain)); return s
    def ui(self, spec, sub=None, region_gain=-9.0):
        s = self.t; sub = sub or (0.0, spec["dur"]); dq = V.q(sub[1] - sub[0])
        self.items.append(dict(kind="u", spec=spec, sub=(round(sub[0] * V.FPS) / V.FPS, sub[1]), dur=dq, start=s)); self.t += dq
        self.amb.append((s, s + dq, region_gain)); return s
    # ---- rendering
    def build_video(self):
        """Render every footage / UI segment at the active format (config.W x config.H) and concatenate them."""
        segs = []
        for i, it in enumerate(self.items):
            out = self.work / f"seg{i:02d}.mp4"
            if it["kind"] == "f": V.footage_segment(out, it["clip"], it["t_in"], it["dur"], **it["kw"])
            else:
                src = V.render_ui_scene(it["spec"]); V.cut_range(src, out, it["sub"][0], it["dur"])
            segs.append(out)
        return V.concat(segs, self.work / "video.mp4")

    def render_picture(self, audio_master):
        """Picture-only render for a non-9:16 format. The picture timeline is identical to the 9:16 master (every cut is derived
        from the same measured audio durations), so the finished master's audio stream is copied bit-for-bit: same mix, same
        loudness, no re-encode."""
        audio_master = Path(audio_master)
        if not audio_master.exists(): raise FileNotFoundError(f"build the 9x16 master first: {audio_master}")
        vid = self.build_video()
        dv, da = V.duration(vid), V.duration(audio_master)
        if abs(dv - da) > 0.05: raise RuntimeError(f"timeline mismatch: picture {dv:.3f}s vs master {da:.3f}s")
        final = OUTDIR / f"TradeCatch_{self.key}_{self.lang.upper()}_{C.FMT}.mp4"
        V.mux_copy_audio(vid, audio_master, final)
        print(json.dumps(dict(file=final.name, seconds=round(dv, 2), master_seconds=round(da, 2)), indent=1)); return final

    def render(self, music_bed, music_gain_db=-11.0, amb_kind=None, out_name=None):
        amb_kind = amb_kind or self.amb_kind
        total = V.q(self.t); mix = self.mix
        # ambience bed with per-scene level (footage = in the room, UI = phone-internal)
        tone = M.room_tone(total + 1, amb_kind); n = len(tone); env = np.zeros(n, dtype=np.float32)
        for t0, t1, g in self.amb:
            env[int(t0 * SR):int(t1 * SR)] = M.db(g)
        k = int(0.25 * SR); ker = np.hanning(2 * k + 1); ker /= ker.sum(); env = np.convolve(env, ker, mode="same")
        mix.place("amb", tone * env, 0.0)
        # music
        bed = M.music(music_bed)
        need = int((total + 0.2) * SR)
        if len(bed) < need: self.notes.append(f"WARNING: music bed {len(bed)/SR:.1f}s shorter than ad {total:.1f}s")
        bed = bed[:need]
        mix.place("music", bed, 0.0, 0.0, fin=0.5, fout=2.2)
        # --- video
        vid = self.build_video()
        # --- audio
        stereo = mix.render(music_gain_db=music_gain_db)[:int(total * SR)]
        mastered, stats = M.master(stereo)
        wav = self.work / "master.wav"; write_wav(wav, mastered)
        name = out_name or f"TradeCatch_{self.key}_{self.lang.upper()}_9x16"
        final = OUTDIR / f"{name}.mp4"
        V.mux(vid, wav, final)
        L, tp = lufs(mastered)
        info = dict(file=str(final.name), seconds=round(total, 2), integrated_lufs=round(L, 1), true_peak_dbfs=round(tp, 1),
                    pre_master=stats, notes=self.notes)
        (self.work / "info.json").write_text(json.dumps(info, indent=1, default=str), encoding="utf-8")
        print(json.dumps(info, indent=1, default=str)); return final


def phone_pulses(sample="phone_buzz_toolbox", limit=3.0):
    p = M.detect_pulses(M.sfx(sample)); return [list(x) for x in p if x[1] <= limit]

# =====================================================================================================
# AD A  "Under the Sink"  - plumber, daytime, AI receptionist answers while he works
# =====================================================================================================
# Minimum on-screen time (seconds) of the beats of "Under the sink". The picture is cut from measured audio durations, so
# a longer FR line still stretches its own scene; these floors only stop a beat from flashing by when the line is short.
HOLD = dict(busy=4.2, call=4.0, pickup=4.4)
END_CARD_FULL_AT = 1.95        # when the end card's button, address and disclosure have finished fading in
CTA_MIN_VISIBLE = 5.0          # the call to action stays fully visible at least this long

def build_A(lang):
    ad = Ad("A_UnderTheSink", lang); d = ad.d
    # S1  cold open: the problem (footage)
    # Pacing (website demo): every beat holds long enough to read, see HOLD in build_A. Normal playback speed; nothing is slowed.
    s1 = ad.footage("p_before", 0.0, HOLD["busy"], zoom=(1.07, 1.15), anchor=(0.5, 0.78), seed=1, a45=(0.5, 0.40, 0.90))
    ad.sfx("wrench_work", s1 + 0.0, -9, ref=-27, off=0.5, dur=HOLD["busy"] + 0.2)
    ad.sfx("fabric_kneel", s1 + 0.3, -8, ref=-30)
    ad.sfx("drip", s1 + 1.7, -12, ref=-30)
    ad.sfx("phone_buzz_tile", s1 + 1.0, -2, ref=-25)                 # phone lights up on screen at ~1.0 s
    vo1_end = ad.vo("A_vo1", s1 + 0.25)
    # S2  UI: the call comes in on the contractor's phone, then lapses into a missed call
    s2 = ad.t; D2 = max(HOLD["call"], vo1_end + 0.25 - s2); miss = round(D2 - 0.85, 2)
    sp = U.spec_incoming(lang, D2, miss); sp["pulses"] = phone_pulses(limit=miss)
    ad.sfx("phone_buzz_toolbox", s2, -1, ref=-24, dur=miss + 0.2)
    ad.sfx("phone_ring_floor", s2, -10, ref=-26, dur=miss + 0.2)
    ad.sfx("call_end", s2 + miss, -7, ref=-26)
    ad.ui(sp)
    # S3  UI (customer's phone): rings out, caller gives up and tries someone else
    s3 = ad.t; vo2_end = ad.vo("A_vo2", s3 + 0.2) - s3
    rings = [(0.30, 1.00), (1.55, 2.25)]
    sigh0 = max(vo2_end - 0.10, 2.35); sigh_end = sigh0 + ad.d("A_sigh")
    end_at = round(sigh0 + 1.05, 2); search_at = round(end_at + 0.30, 2); tap_at = round(search_at + 0.85, 2); D3 = round(tap_at + 0.40, 2)
    ad.mix.place("sfx", M.ringback(rings, D3 + 0.2, level_db=-22), s3)
    ad.vo("A_sigh", s3 + sigh0, kind="room", who="cust")
    ad.sfx("call_end", s3 + end_at, -8, ref=-26)
    ad.sfx("ui_tap", s3 + tap_at, -4, ref=-28)
    ad.ui(U.spec_calling(lang, D3, end_at, search_at, tap_at))
    # S4  the reset: same job, this time TradeCatch picks up
    D4 = max(HOLD["pickup"], ad.d("A_vo3") + 0.25)
    s4 = ad.footage("p_after", 0.2, D4, zoom=(1.08, 1.14), anchor=(0.5, 0.78), seed=2, a45=(0.5, 0.45, 0.90))
    ad.sfx("whoosh_hit", s4 - 0.35, -9, ref=-26)
    ad.sfx("wrench_work", s4, -9, ref=-27, off=3.0, dur=D4)
    ad.sfx("phone_buzz_tile", s4 + 0.8, -4, ref=-25)
    ad.vo("A_vo3", s4 + 0.18)
    # S5  the call (customer's phone UI) with one cutaway to the plumber working calmly
    s5 = ad.t; tt = 0.6; line = {}
    ad.sfx("call_connect", s5 + 0.05, -6, ref=-26)
    order = [("A_r1", "recep", 0.0), ("A_c1", "cust", 0.14), ("A_r2", "recep", 0.20), ("A_c2", "cust", 0.12), ("A_r3", "recep", 0.20)]
    for lid, who, gap in order:
        tt += gap; line[lid] = tt; tt += ad.vo(lid, s5 + tt, kind="call", who=who) - (s5 + tt)
    end5 = round(tt + 0.30, 2)
    cutA0 = line["A_r2"] + 0.40; cutA1 = line["A_c2"] - 0.28
    env_r = ad.mix.envelope("recep", s5, end5); env_c = ad.mix.envelope("cust", s5, end5)
    live = U.spec_live(lang, end5, env_r, env_c, V.FPS * 2, connect_at=0.5)
    ad.ui(live, sub=(0.0, cutA0))
    ca = ad.t
    ad.mix.cut_windows.append((ca, ca + (cutA1 - cutA0)))
    ad.footage("p_after", 5.0, cutA1 - cutA0, zoom=(1.08, 1.13), anchor=(0.45, 0.6), seed=3, region_gain=+3.0, a45=(0.45, 0.42))
    ad.sfx("wrench_work", ca, -3, ref=-27, off=1.0, dur=cutA1 - cutA0)
    ad.sfx("tool_clink", ca + (cutA1 - cutA0) - 0.9, -6, ref=-26)
    ad.ui(live, sub=(cutA1, end5))
    # S6  payoff: he keeps working; the request lands on his phone with every detail
    s6 = ad.t
    notif_at, tap_notif, card_at = 0.60, 1.85, 2.00                    # the notification is readable ~1.3 s before the tap
    outcome_at = round(card_at + 0.50 + 5 * 0.22 + 0.15, 2); confirm_tap = round(outcome_at + 1.80, 2); D6 = round(confirm_tap + 1.20, 2)
    lead = U.spec_lead(lang, D6, notif_at, tap_notif, card_at, outcome_at, confirm_tap, "A", "2:19")
    ad.sfx("notif_lead", s6 + notif_at, -4, ref=-25); ad.sfx("phone_buzz_tile", s6 + notif_at - 0.05, -9, ref=-25, dur=0.8)
    ad.sfx("ui_tap", s6 + tap_notif, -4, ref=-28)
    ad.ui(lead, sub=(0.0, card_at))
    sm = ad.t
    ad.footage("p_after", 7.7, 2.2, zoom=(1.12, 1.18), anchor=(0.5, 0.55), seed=4, region_gain=+3.0, a45=(0.5, 0.5))
    ad.sfx("wrench_work", sm, -6, ref=-27, off=5.0, dur=2.3)
    vo4_end = ad.vo("A_vo4", sm + 0.05)
    ad.ui(lead, sub=(card_at, D6))
    s6b = ad.t - (D6 - card_at)                                    # absolute start of the card half
    ad.sfx("ui_tap", s6b + (confirm_tap - card_at), -4, ref=-28)
    ad.sfx("notif_lead", s6b + (confirm_tap - card_at) + 0.25, -11, ref=-25)
    # S7  end card: brand line lands as the logo draws in, action line as the button appears
    s7 = ad.t
    c1 = max(vo4_end + 0.20, s7 - 0.35); c1_end = ad.vo("CTA1", c1)
    c2 = c1_end + 0.22; c2_end = ad.vo("CTA2", c2)
    # The button, address and disclosure are fully drawn 1.95 s into the end card (ui.html SC.end); hold them 5+ s.
    D7 = max(round(c2_end - s7 + 0.95, 2), round(END_CARD_FULL_AT + CTA_MIN_VISIBLE + 0.2, 2))
    ad.mix.place("music", M.music("sting"), s7 - 0.05, -2.5)
    ad.ui(U.spec_end(lang, D7), region_gain=-14.0)
    return ad

def end_card(ad, lang, prev_end):
    """Brand end card: line 1 lands as the logo draws in, line 2 as the button appears."""
    s7 = ad.t
    c1 = max(prev_end + 0.20, s7 - 0.35); c1_end = ad.vo("CTA1", c1)
    c2 = c1_end + 0.22; c2_end = ad.vo("CTA2", c2)
    D7 = round(c2_end - s7 + 0.95, 2)
    ad.mix.place("music", M.music("sting"), s7 - 0.05, -2.5)
    ad.ui(U.spec_end(lang, D7), region_gain=-14.0)

# =====================================================================================================
# AD B  "The Ladder"  - electrician on a ladder; a missed call gets an instant text back (SMS receptionist)
# =====================================================================================================
def build_B(lang):
    ad = Ad("B_TheLadder", lang); d = ad.d; LAD = dict(grade="ladder")
    # S1  cold open: hands overhead on a ladder, the phone rings out of reach
    s1 = ad.footage("e_before", 0.0, 3.5, zoom=(1.03, 1.09), anchor=(0.5, 0.45), seed=11, a45=(0.5, 0.14), **LAD)
    ad.sfx("ladder_creak", s1 + 0.2, -8, ref=-30)
    ad.sfx("fixture_work", s1, -7, ref=-29, dur=3.6)
    ad.sfx("phone_buzz_toolbox", s1 + 0.15, -6, ref=-25, dur=3.3)
    ad.sfx("phone_ring_floor", s1 + 0.15, -13, ref=-27, dur=3.3)
    vo1_end = ad.vo("B_vo1", s1 + 0.35)
    # S2  the call lapses into a missed call on his phone
    s2 = ad.t; vo2_end = ad.vo("B_vo2", s2 + 0.20)
    D2 = round(max(2.6, vo2_end - s2 + 0.15), 2); miss = round(D2 - 1.0, 2)
    sp = U.spec_incoming(lang, D2, miss, number="(450) 555-0187"); sp["pulses"] = phone_pulses(limit=miss)
    ad.sfx("phone_buzz_toolbox", s2, -1, ref=-24, dur=miss + 0.2)
    ad.sfx("phone_ring_floor", s2, -10, ref=-26, dur=miss + 0.2)
    ad.sfx("call_end", s2 + miss, -7, ref=-26)
    ad.ui(sp)
    # S3  a beat: the phone is dark, he keeps working, the caller is gone
    s3 = ad.footage("e_before", 6.6, 1.4, zoom=(1.05, 1.10), anchor=(0.5, 0.4), seed=12, a45=(0.5, 0.12), **LAD)
    ad.sfx("fixture_work", s3, -8, ref=-29, off=1.0, dur=1.5)
    ad.sfx("ladder_creak", s3 + 0.5, -10, ref=-31)
    # S4  the text-back thread (customer's phone); one cutaway to him working calmly while it plays out
    s4 = ad.t; dv3 = d("B_vo3")
    ad.sfx("whoosh_soft", s4 - 0.30, -9, ref=-26)
    ad.vo("B_vo3", s4 + 0.15)
    texts = [t for _, t in U.STR[lang]["sms"]]
    m1_at = round(0.15 + 0.52 * dv3, 2); m1_ty = round(m1_at - 1.05, 2)
    m2_ts = round(m1_at + 0.90, 2); m2_te = round(m2_ts + max(1.4, len(texts[1]) / 44), 2); m2_at = round(m2_te + 0.15, 2)
    cut_a = round(m2_at + 0.25, 2)
    m3_ty = round(m2_at + 0.50, 2); m3_at = round(m3_ty + 0.95, 2); cut_b = round(m3_at + 0.50, 2)
    m4_ts = round(cut_b + 0.10, 2); m4_te = round(m4_ts + max(1.0, len(texts[3]) / 44), 2); m4_at = round(m4_te + 0.15, 2)
    m5_ty = round(m4_at + 0.50, 2); m5_at = round(m5_ty + 0.95, 2); end4 = round(m5_at + 0.95, 2)
    times = [dict(at=m1_at, typingAt=m1_ty), dict(typeStart=m2_ts, typeEnd=m2_te, at=m2_at),
             dict(at=m3_at, typingAt=m3_ty), dict(typeStart=m4_ts, typeEnd=m4_te, at=m4_at), dict(at=m5_at, typingAt=m5_ty)]
    sms = U.spec_sms(lang, end4, times)
    ad.sfx("sms_in", s4 + m1_at, -3, ref=-25)
    ad.mix.place("sfx", M.typing_track(m2_ts, m2_te, len(texts[1]), end4 + 0.5), s4)
    ad.sfx("sms_sent", s4 + m2_at, -5, ref=-26)
    ad.ui(sms, sub=(0.0, cut_a))
    ca = ad.t
    ad.footage("e_after", 1.0, cut_b - cut_a, zoom=(1.05, 1.10), anchor=(0.5, 0.4), seed=13, region_gain=+3.0, a45=(0.5, 0.12), **LAD)
    ad.sfx("fixture_work", ca, -6, ref=-29, off=2.0, dur=cut_b - cut_a + 0.1)
    ad.sfx("sms_in", s4 + m3_at, -7, ref=-25); ad.sfx("phone_buzz_tile", s4 + m3_at - 0.05, -11, ref=-25, dur=0.6)
    ad.mix.place("sfx", M.typing_track(m4_ts, m4_te, len(texts[3]), end4 + 0.5), s4)
    ad.sfx("sms_sent", s4 + m4_at, -5, ref=-26)
    ad.sfx("sms_in", s4 + m5_at, -3, ref=-25)
    ad.ui(sms, sub=(cut_b, end4))
    # S5  wrap-up beat, then the request is waiting on his phone
    s5 = ad.footage("e_after", 7.0, 1.5, zoom=(1.05, 1.10), anchor=(0.5, 0.4), seed=14, a45=(0.5, 0.12), **LAD)
    ad.sfx("fixture_work", s5, -7, ref=-29, off=3.5, dur=1.6)
    v4_end = ad.vo("B_vo4", s5 + 0.10)
    s6 = ad.t; notif_at, tap_notif, card_at = 0.15, 1.00, 1.15
    outcome_at = round(card_at + 0.50 + 4 * 0.22 + 0.15, 2); confirm_tap = round(outcome_at + 0.95, 2); D6 = round(confirm_tap + 0.80, 2)
    lead = U.spec_lead(lang, D6, notif_at, tap_notif, card_at, outcome_at, confirm_tap, "B", "2:21")
    ad.sfx("notif_lead", s6 + notif_at, -4, ref=-25); ad.sfx("phone_buzz_tile", s6 + notif_at - 0.05, -9, ref=-25, dur=0.8)
    ad.sfx("ui_tap", s6 + tap_notif, -4, ref=-28)
    ad.sfx("ui_tap", s6 + confirm_tap, -4, ref=-28); ad.sfx("notif_lead", s6 + confirm_tap + 0.25, -11, ref=-25)
    ad.ui(lead)
    end_card(ad, lang, v4_end)
    return ad

# =====================================================================================================
# AD C  "After Hours"  - night; an emergency call is transferred to the on-call line, the rest waits as a summary
# =====================================================================================================
def water_under_call(ad, t0, dur, lufs_near=-33.0):
    """Flooding water on the caller's end of the line (phone-band on the near bus, muffled on the 'far' bus)."""
    w = M.sfx("amb_water_flood"); n = int(dur * SR)
    if len(w) < n:                                              # loop with a crossfade
        x = int(0.6 * SR); out = w.copy()
        while len(out) < n + x:
            nxt = w.copy(); f = np.linspace(0, 1, x).astype(np.float32)
            out[-x:] = out[-x:] * (1 - f) + nxt[:x] * f; out = np.concatenate([out, nxt[x:]])
        w = out
    w = w[:n]
    near = M.normalize_to(ff_filter(w, "highpass=f=220,lowpass=f=3600"), lufs_near)
    far = M.normalize_to(ff_filter(w, M.FAR_AF), lufs_near - 7)
    ad.mix.place("call", near, t0, fin=0.5, fout=0.5); ad.mix.place("far", far, t0, fin=0.5, fout=0.5)

def build_C(lang):
    ad = Ad("C_AfterHours", lang); d = ad.d; NIT = dict(grade="night"); ad.amb_kind = "night"
    # S1  cold open: night, still working
    s1 = ad.footage("p_night", 0.0, 2.9, zoom=(1.04, 1.10), anchor=(0.35, 0.55), seed=21, a45=(0.35, 0.22), **NIT)
    ad.sfx("wrench_work", s1, -8, ref=-27, off=0.5, dur=3.0)
    ad.sfx("pipe_tap", s1 + 1.6, -8, ref=-28)
    ad.sfx("drip", s1 + 0.7, -12, ref=-30)
    vo1_end = ad.vo("C_vo1", s1 + 0.25)
    # S2  the after-hours call (customer's phone): greeting, emergency, transfer; cutaway as the transfer lands
    s2 = ad.t; tt = 0.5; line = {}
    ad.sfx("call_connect", s2 + 0.05, -6, ref=-26)
    for lid, who, gap in [("C_r1", "recep", 0.0), ("C_c1", "cust", 0.15), ("C_r2", "recep", 0.18)]:
        tt += gap; line[lid] = tt; tt += ad.vo(lid, s2 + tt, kind="call", who=who) - (s2 + tt)
    end2 = round(tt + 0.30, 2)
    CUT = 2.0; cutC0 = round(end2 - CUT, 2)
    water_under_call(ad, s2 + line["C_c1"] - 0.35, end2 - line["C_c1"] + 0.35)
    env_r = ad.mix.envelope("recep", s2, end2); env_c = ad.mix.envelope("cust", s2, end2)
    live = U.spec_live(lang, end2, env_r, env_c, V.FPS * 2, connect_at=0.5, time="9:48")
    ad.ui(live, sub=(0.0, cutC0))
    ca = ad.t
    ad.mix.cut_windows.append((ca, ca + CUT))
    ad.footage("p_night", 5.7, CUT, zoom=(1.06, 1.11), anchor=(0.35, 0.55), seed=22, region_gain=+3.0, a45=(0.35, 0.4), **NIT)
    ad.sfx("wrench_work", ca, -4, ref=-27, off=2.5, dur=CUT)
    ad.sfx("phone_buzz_tile", ca + CUT - 0.75, -4, ref=-25, dur=0.8)
    # S3  his phone: the emergency transfer arrives and he takes it
    s3 = ad.t; ans = 2.2; D3 = round(ans + 1.0, 2)
    tr = U.spec_transfer(lang, D3, ans); tr["pulses"] = phone_pulses(limit=ans)
    ad.sfx("phone_buzz_toolbox", s3, -1, ref=-24, dur=ans + 0.2)
    ad.sfx("phone_ring_floor", s3, -10, ref=-26, dur=ans + 0.2)
    ad.sfx("ui_tap", s3 + ans - 0.05, -4, ref=-28)
    ad.sfx("call_connect", s3 + ans + 0.10, -7, ref=-26)
    ad.ui(tr)
    # S4  he gets on it; the narration explains what reaches him and what waits
    s4 = ad.footage("p_night", 7.7, 2.0, zoom=(1.06, 1.11), anchor=(0.35, 0.55), seed=23, a45=(0.35, 0.3), **NIT)
    ad.sfx("wrench_work", s4, -7, ref=-27, off=3.0, dur=2.1)
    ad.sfx("keys_truck", s4 + 0.9, -9, ref=-28, dur=1.1)
    dv3 = d("C_vo3"); vo3_end = ad.vo("C_vo3", s4 + 0.05)
    # S5  morning: the rest is waiting as a summary
    s5 = ad.t; notif_at = round(max(0.25, 0.47 * dv3 - 1.85), 2); tap_notif = round(notif_at + 0.95, 2); card_at = round(tap_notif + 0.15, 2)
    outcome_at = round(card_at + 0.50 + 2 * 0.22 + 0.35, 2); confirm_tap = round(outcome_at + 1.0, 2); D5 = round(confirm_tap + 0.80, 2)
    lead = U.spec_lead(lang, D5, notif_at, tap_notif, card_at, outcome_at, confirm_tap, "C", "7:02", date=U.STR[lang]["dateNext"])
    ad.sfx("notif_lead", s5 + notif_at, -4, ref=-25); ad.sfx("phone_buzz_tile", s5 + notif_at - 0.05, -9, ref=-25, dur=0.8)
    ad.sfx("ui_tap", s5 + tap_notif, -4, ref=-28)
    ad.sfx("ui_tap", s5 + confirm_tap, -4, ref=-28)
    ad.ui(lead)
    end_card(ad, lang, max(vo3_end, s5 + D5 - 0.4))
    return ad

BUILDERS = {"A": (build_A, "bed_A"), "B": (build_B, "bed_B"), "C": (build_C, "bed_C")}

if __name__ == "__main__":
    # python build_ads.py <A|B|C> <en|fr> [--format 9x16|4x5] [--no-render]
    key, lang = sys.argv[1], sys.argv[2]
    fmt = sys.argv[sys.argv.index("--format") + 1] if "--format" in sys.argv else "9x16"
    C.set_format(fmt)
    fn, bed = BUILDERS[key]
    ad = fn(lang)
    print(f"planned length: {ad.t:.2f}s  items={len(ad.items)}  format={fmt}")
    if "--no-render" not in sys.argv:
        if fmt == "9x16": ad.render(bed)
        else: ad.render_picture(OUTDIR / f"TradeCatch_{ad.key}_{lang.upper()}_9x16.mp4")
