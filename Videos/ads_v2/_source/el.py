"""Minimal ElevenLabs client (stdlib only). Key is read from the project's .env.local and never printed."""
import json, re, urllib.request, urllib.error, pathlib
def _key():
    for line in open(pathlib.Path(__file__).resolve().parents[3]/".env.local",encoding="utf-8",errors="ignore"):
        m=re.match(r'^ELEVENLABS_API_KEY=(.*)$',line.strip())
        if m: return m.group(1).strip().strip('"').strip("'")
    raise SystemExit("no key")
K=_key()
BASE="https://api.elevenlabs.io"
def call(path, body=None, method=None, timeout=180):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(BASE+path,data=data,method=method or ("POST" if body is not None else "GET"),
        headers={"xi-api-key":K,"Content-Type":"application/json","Accept":"*/*"})
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)
def usage():
    s,b,_=call("/v1/user/subscription")
    d=json.loads(b); return d["character_count"], d["character_limit"]
def tts(voice_id, text, out, model="eleven_v3", stability=0.5, similarity=0.8, style=0.0, speed=1.0, lang=None, fmt="mp3_44100_128"):
    body={"text":text,"model_id":model,"voice_settings":{"stability":stability,"similarity_boost":similarity,"style":style,"use_speaker_boost":True,"speed":speed}}
    if lang: body["language_code"]=lang
    s,b,h=call(f"/v1/text-to-speech/{voice_id}?output_format={fmt}",body)
    if s==200: pathlib.Path(out).write_bytes(b)
    return s,(b if s!=200 else len(b)),h
def sfx(text, out, seconds=None, influence=0.5):
    body={"text":text,"prompt_influence":influence}
    if seconds: body["duration_seconds"]=seconds
    s,b,h=call("/v1/sound-generation?output_format=mp3_44100_128",body)
    if s==200: pathlib.Path(out).write_bytes(b)
    return s,(b if s!=200 else len(b)),h

import uuid, mimetypes
def stt(path, lang=None, model="scribe_v1"):
    b=uuid.uuid4().hex
    fields={"model_id":model}
    if lang: fields["language_code"]=lang
    parts=[]
    for k,v in fields.items():
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    data=pathlib.Path(path).read_bytes()
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{pathlib.Path(path).name}"\r\nContent-Type: {mimetypes.guess_type(path)[0] or "application/octet-stream"}\r\n\r\n'.encode()+data+b'\r\n')
    parts.append(f'--{b}--\r\n'.encode())
    req=urllib.request.Request(BASE+"/v1/speech-to-text",data=b"".join(parts),method="POST",headers={"xi-api-key":K,"Content-Type":f"multipart/form-data; boundary={b}"})
    try:
        with urllib.request.urlopen(req,timeout=180) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e: return {"error":e.code,"body":e.read().decode()[:300]}
