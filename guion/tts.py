#!/usr/bin/env python3
"""
tts.py - voz artificial para un guión de Reel, un clip de audio por beat.

Genera un archivo de audio por beat, mide la duración real de cada uno y arma
el timeline.json para Remotion con esos tiempos: tarjetas y subtítulos quedan
exactamente sincronizados con la voz.

Motores (--engine):
  elevenlabs  (default) La mejor calidad en español; permite clonar tu propia voz.
              Necesita ELEVENLABS_API_KEY en el .env. La voz sale de --voice o de
              ELEVENLABS_VOICE_ID en el .env (python tts.py --voces lista las de tu cuenta).
  azure       Azure AI Speech (Microsoft oficial, gratis hasta 500k caracteres/mes).
              Voces argentinas es-AR-TomasNeural / es-AR-ElenaNeural.
              Necesita AZURE_SPEECH_KEY y AZURE_SPEECH_REGION en el .env.
  kokoro      Local, gratis, sin internet. Calidad básica. pip install kokoro-onnx soundfile
  edge        Microsoft Edge no oficial; a veces responde 403. pip install edge-tts mutagen

Uso
  python tts.py guion.txt                               # kokoro, voz em_alex
  python tts.py guion.txt --voice ef_dora               # femenina
  python tts.py guion.txt --speed 1.1                   # más rápido
  python tts.py guion.txt --engine elevenlabs --voice <voice_id>
  python tts.py guion.txt --engine edge --voice es-AR-TomasNeural
  python tts.py --voces                                 # lista voces por motor
  python tts.py guion.txt --out ../video/public/voz/mi-reel

Salida (en --out, default ../video/public/voz/<nombre-del-guion>/):
  beat-1.wav|mp3 ... beat-N.*
  timeline.json          <- pasar a Remotion con --props
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from beats import parse_script, FPS  # noqa: E402

GAP_FRAMES = 6        # silencio entre beats (0.2 s a 30 fps)
TAIL_FRAMES = 18      # cola al final del video (0.6 s)

VOICES = {
    "kokoro": {
        "em_alex": "masculina, neutra (recomendada)",
        "em_santa": "masculina, más grave",
        "ef_dora": "femenina, neutra",
    },
    "elevenlabs": {},
    "azure": {
        "es-AR-TomasNeural": "masculina, Argentina (default)",
        "es-AR-ElenaNeural": "femenina, Argentina",
        "es-MX-JorgeNeural": "masculina, México",
        "es-MX-DaliaNeural": "femenina, México",
        "es-US-AlonsoNeural": "masculina, latino neutro",
    },
    "edge": {
        "es-AR-TomasNeural": "masculina, Argentina",
        "es-AR-ElenaNeural": "femenina, Argentina",
        "es-MX-JorgeNeural": "masculina, México",
        "es-MX-DaliaNeural": "femenina, México",
    },
}
DEFAULT_VOICE = {"elevenlabs": None, "azure": "es-AR-TomasNeural", "kokoro": "em_alex", "edge": "es-AR-TomasNeural"}

KOKORO_FILES = {
    "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
}


# ───────────────────────── utilidades ─────────────────────────

def slug(s):
    s = re.sub(r"[^\w\s-]", "", s.lower(), flags=re.UNICODE)
    return re.sub(r"[\s_-]+", "-", s).strip("-")[:40] or "reel"


def makedirs(path):
    """os.makedirs con respaldo para el Python de la Microsoft Store en Windows."""
    try:
        os.makedirs(path, exist_ok=True)
    except FileNotFoundError:
        if os.name == "nt":
            subprocess.run(["cmd", "/c", "mkdir", path], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not os.path.isdir(path):
            raise


def load_env():
    """Lee ../.env (KEY=VALUE) sin dependencias."""
    p = os.path.normpath(os.path.join(HERE, "..", ".env"))
    env = {}
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def audio_duration(path):
    """Duración en segundos para wav o mp3."""
    if path.lower().endswith(".wav"):
        import soundfile as sf
        info = sf.info(path)
        return float(info.frames) / float(info.samplerate)
    try:
        from mutagen.mp3 import MP3
        return float(MP3(path).info.length)
    except Exception:
        pass
    candidates = ["ffprobe"]
    root = os.path.normpath(os.path.join(HERE, "..", "video", "node_modules", "@remotion"))
    if os.path.isdir(root):
        for d in os.listdir(root):
            if d.startswith("compositor-"):
                candidates += [os.path.join(root, d, n) for n in ("ffprobe.exe", "ffprobe")]
    for ffprobe in candidates:
        try:
            out = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", path],
                capture_output=True, text=True, check=True).stdout.strip()
            return float(out)
        except Exception:
            continue
    raise SystemExit("No pude medir la duración del audio. Instalá mutagen: pip install mutagen")


# ───────────────────────── motores ─────────────────────────

class KokoroEngine:
    ext = "wav"

    def __init__(self, voice, speed):
        try:
            from kokoro_onnx import Kokoro
        except ImportError:
            raise SystemExit("Falta kokoro-onnx. Instalá con:  pip install kokoro-onnx soundfile")
        models = os.path.join(HERE, "modelos")
        makedirs(models)
        paths = {}
        for name, url in KOKORO_FILES.items():
            p = os.path.join(models, name)
            if not os.path.exists(p) or os.path.getsize(p) < 1_000_000:
                print(f"⬇️  Descargando {name} (una sola vez)…")
                tmp = p + ".part"
                urllib.request.urlretrieve(url, tmp)
                os.replace(tmp, p)
            paths[name] = p
        self.k = Kokoro(paths["kokoro-v1.0.onnx"], paths["voices-v1.0.bin"])
        self.voice, self.speed = voice, speed

    def synth(self, text, out_path):
        import soundfile as sf
        samples, sr = self.k.create(text, voice=self.voice, speed=self.speed, lang="es")
        sf.write(out_path, samples, sr)


# Estilos de voz para ElevenLabs. "cinematografico": más dramática y grave,
# con más expresividad (style) y menos estabilidad, como un tráiler.
ESTILOS = {
    "normal": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": True},
    "cinematografico": {"stability": 0.32, "similarity_boost": 0.85, "style": 0.6, "use_speaker_boost": True},
}
ESTILO_ACTUAL = "normal"


class ElevenLabsEngine:
    ext = "mp3"

    def __init__(self, voice, speed):
        key = os.environ.get("ELEVENLABS_API_KEY") or load_env().get("ELEVENLABS_API_KEY")
        if not key:
            raise SystemExit("Falta ELEVENLABS_API_KEY. Agregala al archivo .env del proyecto.")
        if not voice:
            raise SystemExit("ElevenLabs necesita --voice <voice_id> (Voices → tu voz → ID).")
        self.key, self.voice, self.speed = key, voice, speed

    def synth(self, text, out_path):
        body = json.dumps({
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": dict(ESTILOS.get(ESTILO_ACTUAL, ESTILOS["normal"]),
                                   speed=max(0.7, min(1.2, self.speed))),
        }).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice}?output_format=mp3_44100_128",
            data=body, method="POST",
            headers={"xi-api-key": self.key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r, open(out_path, "wb") as f:
                f.write(r.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")
            try:
                d = json.loads(body).get("detail", {})
                msg = f"{d.get('status', '')}: {d.get('message', body)}" if isinstance(d, dict) else str(d)
            except Exception:
                msg = body[:400]
            raise SystemExit(f"❌ ElevenLabs {e.code} — {msg}")


class AzureEngine:
    """Azure AI Speech (oficial). Necesita AZURE_SPEECH_KEY y AZURE_SPEECH_REGION en .env."""
    ext = "mp3"

    def __init__(self, voice, speed):
        env = load_env()
        self.key = os.environ.get("AZURE_SPEECH_KEY") or env.get("AZURE_SPEECH_KEY")
        self.region = os.environ.get("AZURE_SPEECH_REGION") or env.get("AZURE_SPEECH_REGION")
        if not self.key or not self.region:
            raise SystemExit("Faltan AZURE_SPEECH_KEY y AZURE_SPEECH_REGION en el .env (ej. region=brazilsouth).")
        self.voice = voice or "es-AR-TomasNeural"
        self.rate = f"{int(round((speed - 1) * 100)):+d}%"

    def synth(self, text, out_path):
        from xml.sax.saxutils import escape
        lang = "-".join(self.voice.split("-")[:2])
        ssml = (f"<speak version='1.0' xml:lang='{lang}'>"
                f"<voice name='{self.voice}'><prosody rate='{self.rate}'>{escape(text)}</prosody></voice></speak>")
        req = urllib.request.Request(
            f"https://{self.region}.tts.speech.microsoft.com/cognitiveservices/v1",
            data=ssml.encode("utf-8"), method="POST",
            headers={"Ocp-Apim-Subscription-Key": self.key,
                     "Content-Type": "application/ssml+xml",
                     "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
                     "User-Agent": "instagram-mcp"})
        with urllib.request.urlopen(req, timeout=60) as r, open(out_path, "wb") as f:
            f.write(r.read())


class EdgeEngine:
    ext = "mp3"

    def __init__(self, voice, speed):
        try:
            import edge_tts  # noqa: F401
        except ImportError:
            raise SystemExit("Falta edge-tts. Instalá con:  pip install edge-tts mutagen")
        self.voice = voice
        self.rate = f"{int(round((speed - 1) * 100)):+d}%"

    def synth(self, text, out_path):
        import asyncio
        import edge_tts

        async def go():
            await edge_tts.Communicate(text, self.voice, rate=self.rate).save(out_path)
        asyncio.run(go())


ENGINES = {"elevenlabs": ElevenLabsEngine, "azure": AzureEngine, "kokoro": KokoroEngine, "edge": EdgeEngine}


def _el_key():
    key = os.environ.get("ELEVENLABS_API_KEY") or load_env().get("ELEVENLABS_API_KEY")
    if not key:
        raise SystemExit("Falta ELEVENLABS_API_KEY en el .env")
    return key


def search_elevenlabs_library(accent="argentin", gender=None, limit=10):
    """
    Busca voces en español en la biblioteca pública de ElevenLabs, ordenadas por
    popularidad, y descarga una muestra de cada una a guion/voces-preview/.
    """
    import urllib.parse
    key = _el_key()
    found = []
    for acc in ([accent] if accent else []) + ["latin", ""]:
        params = {"language": "es", "page_size": 60, "sort": "cloned_by_count"}
        if acc:
            params["search"] = acc
        if gender:
            params["gender"] = gender
        req = urllib.request.Request(
            "https://api.elevenlabs.io/v1/shared-voices?" + urllib.parse.urlencode(params),
            headers={"xi-api-key": key})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        for v in data.get("voices", []):
            if v.get("language", "").startswith("es") and v["voice_id"] not in {f["voice_id"] for f in found}:
                found.append(v)
        if len(found) >= limit:
            break
    found = sorted(found, key=lambda v: -(v.get("cloned_by_count") or 0))[:limit]
    if not found:
        print("No encontré voces con ese criterio.")
        return
    prev_dir = os.path.join(HERE, "voces-preview")
    makedirs(prev_dir)
    cache = []
    print(f"\nVOCES EN ESPAÑOL (biblioteca ElevenLabs) — muestras en {prev_dir}\n")
    for i, v in enumerate(found, 1):
        tags = ", ".join(str(v[k]) for k in ("accent", "gender", "age", "descriptive", "use_case") if v.get(k))
        print(f"  {i:>2}. {v['name']:<28} {tags}   (usada por {v.get('cloned_by_count', 0)})")
        fname = os.path.join(prev_dir, f"{i:02d}-{slug(v['name'])}.mp3")
        try:
            if v.get("preview_url"):
                urllib.request.urlretrieve(v["preview_url"], fname)
        except Exception:
            pass
        cache.append({"n": i, "name": v["name"], "voice_id": v["voice_id"],
                      "public_owner_id": v.get("public_owner_id")})
    with open(os.path.join(prev_dir, ".ultima-busqueda.json"), "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)
    print(f"\nEscuchá las muestras en la carpeta y después agregá las que te gusten:")
    print(f"  python guion\\tts.py --agregar 2,5\n")


def add_elevenlabs_voices(numbers):
    """Agrega a tu cuenta las voces elegidas de la última búsqueda (--buscar)."""
    key = _el_key()
    cache_path = os.path.join(HERE, "voces-preview", ".ultima-busqueda.json")
    if not os.path.exists(cache_path):
        raise SystemExit("Primero corré --buscar para listar voces.")
    cache = {c["n"]: c for c in json.load(open(cache_path, encoding="utf-8"))}
    for n in [int(x) for x in numbers.split(",") if x.strip()]:
        c = cache.get(n)
        if not c:
            print(f"  {n}: no está en la última búsqueda"); continue
        body = json.dumps({"new_name": c["name"]}).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/voices/add/{c['public_owner_id']}/{c['voice_id']}",
            data=body, method="POST",
            headers={"xi-api-key": key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                res = json.load(r)
            print(f"  ✅ {c['name']} agregada → voice_id {res.get('voice_id', c['voice_id'])}")
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "ignore")[:200]
            print(f"  ❌ {c['name']}: {e.code} {msg}")


def list_elevenlabs_voices():
    """Lista las voces de la cuenta (propias + biblioteca agregada) con idioma/acento."""
    key = os.environ.get("ELEVENLABS_API_KEY") or load_env().get("ELEVENLABS_API_KEY")
    if not key:
        print("  (poné ELEVENLABS_API_KEY en el .env para listar tus voces)")
        return
    req = urllib.request.Request("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": key})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    for v in data.get("voices", []):
        lab = v.get("labels") or {}
        tags = ", ".join(str(lab[k]) for k in ("language", "accent", "gender", "age") if lab.get(k))
        print(f"  {v['voice_id']:<24} {v['name']:<22} {tags}")


# ───────────────────────── timeline ─────────────────────────

def build_timeline(items, durations, audio_rel, ext, engine, voice, fps=FPS):
    beats, clock = [], 0
    for i, ((spoken, screen), dur) in enumerate(zip(items, durations)):
        frames = max(1, round(dur * fps))
        label = "GANCHO" if i == 0 else ("CTA" if i == len(items) - 1 else "CUERPO")
        beats.append({
            "id": f"beat-{i + 1}",
            "label": label,
            "from": clock,
            "durationInFrames": frames + GAP_FRAMES,
            "spoken": spoken,
            "onScreen": screen,
            "audio": f"{audio_rel}/beat-{i + 1}.{ext}",
            "audioSeconds": round(dur, 2),
        })
        clock += frames + GAP_FRAMES
    return {
        "fps": fps, "width": 1080, "height": 1920,
        "durationInFrames": clock + TAIL_FRAMES,
        "safeZone": {"top": 230, "bottom": 1440, "right": 850},
        "voice": {"engine": engine, "voice": voice},
        "beats": beats,
    }


def main():
    ap = argparse.ArgumentParser(description="Voz artificial por beat + timeline para Remotion.")
    ap.add_argument("input", nargs="?", help="guión (un beat por línea; '>' = texto en pantalla)")
    ap.add_argument("--engine", choices=ENGINES, default="elevenlabs")
    ap.add_argument("--voice", help="voz del motor (ver --voces)")
    ap.add_argument("--speed", type=float, default=None, help="velocidad, 1.0 = normal (default 1.05; 0.97 en cinematográfico)")
    ap.add_argument("--estilo", choices=["normal", "cinematografico"], default="normal",
                    help="estilo de voz ElevenLabs (cinematografico = tráiler, más dramático)")
    ap.add_argument("--out", help="carpeta de salida (default ../video/public/voz/<slug>)")
    ap.add_argument("--fps", type=int, default=FPS)
    ap.add_argument("--voces", action="store_true", help="lista las voces por motor")
    ap.add_argument("--buscar", nargs="?", const="argentin", metavar="ACENTO",
                    help="busca voces en español en la biblioteca de ElevenLabs (default: argentin)")
    ap.add_argument("--genero", choices=["male", "female"], help="filtro para --buscar")
    ap.add_argument("--agregar", metavar="N,N", help="agrega a tu cuenta las voces N de la última búsqueda")
    args = ap.parse_args()

    if args.buscar is not None:
        search_elevenlabs_library(args.buscar, args.genero)
        return
    if args.agregar:
        add_elevenlabs_voices(args.agregar)
        return

    if args.voces:
        for eng, vs in VOICES.items():
            print(f"\n[{eng}]")
            if eng == "elevenlabs":
                list_elevenlabs_voices()
                continue
            for v, d in vs.items():
                print(f"  {v:<22} {d}")
        print()
        return
    if not args.input:
        ap.error("falta el guión")

    voice = args.voice or DEFAULT_VOICE[args.engine]
    if args.engine == "elevenlabs" and not voice:
        voice = os.environ.get("ELEVENLABS_VOICE_ID") or load_env().get("ELEVENLABS_VOICE_ID")
    raw = open(args.input, encoding="utf-8").read()
    items = [(line, screen) for line, screen in parse_script(raw)]
    if not items:
        raise SystemExit("guión vacío")

    name = slug(os.path.splitext(os.path.basename(args.input))[0])
    public_dir = os.path.normpath(os.path.join(HERE, "..", "video", "public"))
    out_dir = os.path.normpath(os.path.abspath(args.out)) if args.out else os.path.join(public_dir, "voz", name)
    makedirs(out_dir)
    audio_rel = os.path.relpath(out_dir, public_dir).replace(os.sep, "/")
    if audio_rel.startswith(".."):
        audio_rel = f"voz/{name}"

    global ESTILO_ACTUAL
    ESTILO_ACTUAL = args.estilo
    if args.speed is None:
        args.speed = 0.97 if args.estilo == "cinematografico" else 1.05
    engine = ENGINES[args.engine](voice, args.speed)
    print(f"\n🎙  {args.engine} · voz {voice} · estilo {args.estilo} · velocidad {args.speed} · {len(items)} beats\n")
    durations = []
    for i, (spoken, _) in enumerate(items, 1):
        path = os.path.join(out_dir, f"beat-{i}.{engine.ext}")
        engine.synth(spoken, path)
        d = audio_duration(path)
        durations.append(d)
        flag = "  ⚠️ >4s, dividí el beat" if d > 4.3 else ""
        print(f"  beat-{i:<2} {d:5.2f}s  {spoken[:70]}{flag}")

    tl = build_timeline(items, durations, audio_rel, engine.ext, args.engine, voice, fps=args.fps)
    tl_path = os.path.join(out_dir, "timeline.json")
    with open(tl_path, "w", encoding="utf-8") as f:
        json.dump(tl, f, indent=2, ensure_ascii=False)

    total = tl["durationInFrames"] / args.fps
    rel_tl = os.path.relpath(tl_path, os.path.normpath(os.path.join(HERE, "..", "video"))).replace(os.sep, "/")
    print(f"\n✅ {len(items)} clips · {total:.1f}s total · {tl_path}")
    print(f"   Render (desde la carpeta video):\n   npx remotion render ReelFromTimeline out/{name}.mp4 --props={rel_tl}\n")


if __name__ == "__main__":
    main()
