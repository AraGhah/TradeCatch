import json, subprocess, sys, math, shutil
from pathlib import Path
import config as C, ui_specs as U
# usage: python qa_ui.py [en|fr] [9x16|4x5]  -> still frames + a sheet per scene under WORK/qa_ui/<lang>[_<fmt>]
lang = sys.argv[1] if len(sys.argv)>1 else "en"
fmt = sys.argv[2] if len(sys.argv)>2 else "9x16"
C.set_format(fmt)
out = C.WORK / "qa_ui" / (lang if fmt == "9x16" else f"{lang}_{fmt}"); shutil.rmtree(out, ignore_errors=True); out.mkdir(parents=True)
fps = C.FPS
env_r = [max(0,math.sin(i/fps*5))**2*0.8 if (i//fps)%4<2 else 0 for i in range(fps*5)]
env_c = [max(0,math.sin(i/fps*4+1))**2*0.7 if (i//fps)%4>=2 else 0 for i in range(fps*5)]
sms_t=[dict(at=.4),dict(typeStart=1.2,typeEnd=3.2,at=3.6),dict(typingAt=4.2,at=5.6),dict(typeStart=6.4,typeEnd=7.8,at=8.2),dict(typingAt=8.8,at=10.2)]
S = {
 "incoming": (U.spec_incoming(lang,3.0,1.8), [10,36,58]),
 "calling":  (U.spec_calling(lang,6.0,3.6,4.0,5.4), [24,86,118,132]),
 "live":     (U.spec_live(lang,4.0,env_r,env_c,fps,0.4), [8,30,70]),
 "sms":      (U.spec_sms(lang,12.5,sms_t), [24,96,150,290]),
 "leadA":    (U.spec_lead(lang,7.0,.4,1.6,1.8,3.6,5.4), [24,60,90,120,150]),
 "leadC":    (U.spec_lead(lang,6.0,.4,1.4,1.6,3.6,None,"C","9:51"), [24,60,90,130]),
 "transfer": (U.spec_transfer(lang,4.0,2.4), [24,60,84]),
 "end":      (U.spec_end(lang,6.0), [12,30,60,120]),
}
procs=[]
for name,(spec,frames) in S.items():
    sp = out/f"{name}.json"; sp.write_text(json.dumps(dict(spec, w=C.W, h=C.H),ensure_ascii=False),encoding="utf-8")
    procs.append((name,subprocess.Popen(["node",str(C.ROOT/"ui"/"render_ui.mjs"),str(sp),str(out/name),",".join(map(str,frames))],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)))
for name,p in procs:
    o,_=p.communicate(); print(name,(o or "").strip()[-200:])
# build sheets per scene (scaled)
for name,(spec,frames) in S.items():
    files=[str(out/name/f"f{f:05d}.jpg") for f in frames]
    cmd=["ffmpeg","-v","error","-y"]
    for f in files: cmd+=["-i",f]
    n=len(files)
    cmd+=["-filter_complex",f"{''.join(f'[{i}:v]scale=360:-1[v{i}];' for i in range(n))}{''.join(f'[v{i}]' for i in range(n))}hstack=inputs={n}","-frames:v","1",str(out/f"sheet_{name}.jpg")]
    subprocess.run(cmd,check=True)
print("done",out)
