"""ASR round-trip on every generated line: flags words the voice dropped, mangled or read literally."""
import json, re, difflib, sys
import el, config as C
meta = json.loads((C.ASSETS/"voice"/"timing.json").read_text(encoding="utf-8"))
def norm(s):
    s = re.sub(r"\[[^\]]*\]", " ", s.lower().replace("’","'"))
    s = s.replace("tradecatch dot c a","tradecatch.ca").replace("tradecatch point c a","tradecatch.ca")
    s = s.replace("north star","northstar").replace("twenty-minute","20 minute").replace("vingt minutes","20 minutes").replace("twenty minute","20 minute")
    return re.sub(r"[^\w\s]"," ",s).split()
bad = 0
for k, m in meta.items():
    lang, lid = k.split("/")
    t = el.stt(C.ASSETS/"voice"/lang/f"{lid}.mp3", lang=lang).get("text","")
    r, h = norm(m["text"]), norm(t)
    sm = difflib.SequenceMatcher(None, r, h)
    miss = [" ".join(r[i1:i2]) + " -> " + " ".join(h[j1:j2]) for tag,i1,i2,j1,j2 in sm.get_opcodes() if tag != "equal"]
    flag = "OK " if not miss else "CHK"
    if miss: bad += 1
    print(f"{flag} {k:10s} {('; '.join(miss))[:150]}")
print("lines with differences:", bad, "of", len(meta))
