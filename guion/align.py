#!/usr/bin/env python3
"""
align.py - alinea una grabación de tu propia voz con los beats del guión.

Grabás el guión en una sola toma (celular, micrófono, lo que sea), lo pasás
por acá, y Whisper transcribe con tiempos por palabra. El script busca dónde
empieza cada beat dentro de la transcripción y arma el timeline.json para
Remotion con los tiempos reales de tu voz.

Instalar una vez:   pip install faster-whisper
(la primera corrida descarga el modelo, ~150 MB para "small")

Uso
  python align.py guion.txt voz.m4a
  python align.py guion.txt voz.wav --model medium        # más preciso, más lento
  python align.py guion.txt voz.mp3 --out ../video/public/voz/mi-reel

Salida (en --out):
  voz.<ext>              <- copia del audio para /public
  timeline.json          <- pasar a Remotion con --props
  transcripcion.txt      <- lo que Whisper entendió, por si querés revisar

Consejos para grabar:
  - Leé cada beat como una frase cerrada, con una pausa corta entre beats.
  - Si te equivocás, repetí el beat completo: el alineador toma la ÚLTIMA
    aparición coincidente, así que la repetición buena gana.
  - Grabá en un lugar silencioso; el ruido confunde a Whisper.
"""

import argparse
import json
import os
import re
import shutil
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from beats import parse_script, FPS  # noqa: E402

TAIL_FRAMES = 18
WORD_RE = re.compile(r"[a-z0-9ñ]+")


def norm(word):
    """minúsculas, sin tildes, sin puntuación. '3' y 'tres' se igualan."""
    w = unicodedata.normalize("NFKD", word.lower())
    w = "".join(c for c in w if not unicodedata.combining(c))
    w = re.sub(r"[^a-z0-9ñ]", "", w)
    return NUM_WORDS.get(w, w)


NUM_WORDS = {
    "cero": "0", "uno": "1", "una": "1", "dos": "2", "tres": "3", "cuatro": "4",
    "cinco": "5", "seis": "6", "siete": "7", "ocho": "8", "nueve": "9", "diez": "10",
    "primero": "1", "primera": "1", "segundo": "2", "segunda": "2",
    "tercero": "3", "tercera": "3", "cuarto": "4", "cuarta": "4",
}


def transcribe(audio_path, model_size="small", language="es"):
    """Devuelve [(palabra, inicio, fin)] con faster-whisper."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise SystemExit("Falta faster-whisper. Instalá con:  pip install faster-whisper")
    model = WhisperModel(model_size, device="auto", compute_type="int8")
    segments, _ = model.transcribe(audio_path, language=language, word_timestamps=True,
                                   vad_filter=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append((w.word.strip(), float(w.start), float(w.end)))
    return words


def align(items, words, min_match=0.5):
    """
    Para cada beat, busca la ventana de la transcripción que mejor coincide
    con sus palabras, avanzando siempre hacia adelante. Devuelve
    [(inicio, fin, calidad)] por beat.
    """
    tw = [norm(w) for w, _, _ in words]
    results = []
    cursor = 0
    for spoken, _ in items:
        bw = [norm(w) for w in WORD_RE.findall(
            unicodedata.normalize("NFKD", spoken.lower()).encode("ascii", "ignore").decode())]
        bw = [NUM_WORDS.get(w, w) for w in bw if w]
        n = len(bw)
        if n == 0 or cursor >= len(tw):
            results.append(None)
            continue
        best, best_score, best_end = None, -1.0, None
        # ventana deslizante de tamaño n (±2) desde el cursor
        for start in range(cursor, len(tw)):
            for size in (n, n + 1, n - 1, n + 2):
                if size <= 0 or start + size > len(tw):
                    continue
                window = tw[start:start + size]
                hits = sum(1 for w in bw if w in window)
                score = hits / n
                # pequeña preferencia por ventanas más cercanas al cursor y
                # por que la primera palabra coincida
                if window[0] == bw[0]:
                    score += 0.15
                score -= (start - cursor) * 0.002
                if score > best_score:
                    best, best_score, best_end = start, score, start + size
            # Si ya encontramos algo muy bueno, no seguir hasta el final:
            # pero sí permitir que una repetición posterior (toma 2) gane.
        if best is None or best_score < min_match:
            results.append(None)
            continue
        results.append((words[best][1], words[best_end - 1][2], round(min(best_score, 1.0), 2)))
        cursor = best_end
    return results


PAD_BEFORE = 0.06   # segundos de aire antes de cada beat al recortar
PAD_AFTER = 0.22    # segundos de aire después


def find_ffmpeg():
    """ffmpeg del sistema, o el que trae Remotion en node_modules."""
    p = shutil.which("ffmpeg")
    if p:
        return p
    root = os.path.normpath(os.path.join(HERE, "..", "video", "node_modules", "@remotion"))
    if os.path.isdir(root):
        for d in os.listdir(root):
            if d.startswith("compositor-"):
                for name in ("ffmpeg.exe", "ffmpeg"):
                    cand = os.path.join(root, d, name)
                    if os.path.exists(cand):
                        return cand
    return None


def clean_audio(src, spans, out_path, ffmpeg):
    """
    Concatena solo los tramos alineados (con un poco de aire) en un único
    archivo. Devuelve los nuevos spans, contiguos, sobre el audio limpio.
    """
    import subprocess
    import tempfile
    parts, new_spans, clock = [], [], 0.0
    tmpdir = tempfile.mkdtemp()
    for i, s in enumerate(spans):
        if s is None:
            new_spans.append(None)
            continue
        a = max(0.0, s[0] - PAD_BEFORE)
        b = s[1] + PAD_AFTER
        part = os.path.join(tmpdir, f"p{i}.wav")
        subprocess.run([ffmpeg, "-y", "-v", "error", "-i", src, "-ss", f"{a:.3f}", "-to", f"{b:.3f}",
                        "-ar", "44100", "-ac", "1", part], check=True)
        parts.append(part)
        new_spans.append((round(clock, 3), round(clock + (b - a), 3), s[2]))
        clock += b - a
    lst = os.path.join(tmpdir, "list.txt")
    with open(lst, "w", encoding="utf-8") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst,
                    "-c:a", "libmp3lame", "-q:a", "2", out_path], check=True)
    shutil.rmtree(tmpdir, ignore_errors=True)
    return new_spans


def build_timeline(items, spans, audio_rel, fps=FPS):
    beats = []
    # inicio de cada beat = su primera palabra; fin = inicio del siguiente
    starts = []
    for i, s in enumerate(spans):
        if s is None:
            # beat no encontrado: lo pegamos al anterior
            starts.append(starts[-1] if starts else 0.0)
        else:
            starts.append(s[0])
    last_end = max((s[1] for s in spans if s), default=0.0)
    for i, (spoken, screen) in enumerate(items):
        start = starts[i]
        end = starts[i + 1] if i + 1 < len(items) else last_end + 0.3
        frm = round(start * fps)
        dur = max(1, round((end - start) * fps))
        label = "GANCHO" if i == 0 else ("CTA" if i == len(items) - 1 else "CUERPO")
        beats.append({
            "id": f"beat-{i + 1}", "label": label,
            "from": frm, "durationInFrames": dur,
            "spoken": spoken, "onScreen": screen,
            "aligned": spans[i] is not None,
            "matchQuality": spans[i][2] if spans[i] else 0,
        })
    total = beats[-1]["from"] + beats[-1]["durationInFrames"] + TAIL_FRAMES
    return {
        "fps": fps, "width": 1080, "height": 1920,
        "durationInFrames": total,
        "safeZone": {"top": 230, "bottom": 1440, "right": 850},
        "voiceoverSrc": audio_rel,
        "voice": {"engine": "grabada", "alignedWith": "faster-whisper"},
        "beats": beats,
    }


def main():
    ap = argparse.ArgumentParser(description="Alinea tu voz grabada con los beats del guión.")
    ap.add_argument("guion")
    ap.add_argument("audio")
    ap.add_argument("--model", default="small", help="tiny | base | small | medium (default small)")
    ap.add_argument("--out", help="carpeta de salida (default ../video/public/voz/<slug>)")
    ap.add_argument("--fps", type=int, default=FPS)
    ap.add_argument("--sin-limpiar", action="store_true",
                    help="usar la toma entera tal cual (default: recorta a los beats alineados)")
    args = ap.parse_args()

    items = [(l, s) for l, s in parse_script(open(args.guion, encoding="utf-8").read())]
    if not items:
        raise SystemExit("guión vacío")

    name = re.sub(r"[^\w-]+", "-", os.path.splitext(os.path.basename(args.guion))[0].lower()).strip("-")
    public_dir = os.path.normpath(os.path.join(HERE, "..", "video", "public"))
    out_dir = os.path.normpath(os.path.abspath(args.out)) if args.out else os.path.join(public_dir, "voz", name)
    os.makedirs(out_dir, exist_ok=True)
    ext = os.path.splitext(args.audio)[1].lower() or ".wav"
    audio_dst = os.path.join(out_dir, f"voz-original{ext}")
    shutil.copyfile(args.audio, audio_dst)
    audio_rel = f"voz/{name}/voz-original{ext}"

    print(f"\n🎧 Transcribiendo con whisper-{args.model}…")
    words = transcribe(args.audio, args.model)
    with open(os.path.join(out_dir, "transcripcion.txt"), "w", encoding="utf-8") as f:
        f.write(" ".join(w for w, _, _ in words))
    print(f"   {len(words)} palabras, {words[-1][2]:.1f}s de audio" if words else "   (sin palabras)")

    spans = align(items, words)
    print("\nALINEACIÓN")
    print("=" * 72)
    for i, ((spoken, _), s) in enumerate(zip(items, spans), 1):
        if s:
            print(f"  {s[0]:6.2f}s → {s[1]:6.2f}s  [{int(s[2] * 100):3d}%]  {spoken[:60]}")
        else:
            print(f"  {'?':>6}      {'?':>6}   [  0%]  {spoken[:60]}   ⚠️ no encontrado")
    missing = sum(1 for s in spans if s is None)
    low = sum(1 for s in spans if s and s[2] < 0.7)
    if missing or low:
        print(f"\n  ⚠️ {missing} beat(s) sin encontrar, {low} con coincidencia baja. "
              "Revisá transcripcion.txt: puede que hayas leído distinto al guión, o haya ruido.")

    if not args.sin_limpiar and any(spans):
        ff = find_ffmpeg()
        if ff:
            clean_path = os.path.join(out_dir, "voz.mp3")
            spans = clean_audio(audio_dst, spans, clean_path, ff)
            audio_rel = f"voz/{name}/voz.mp3"
            print(f"\n✂️  Audio recortado a los beats alineados → voz.mp3 "
                  f"({spans[-1][1] if spans[-1] else 0:.1f}s)")
        else:
            print("\n(ffmpeg no encontrado: se usa la toma entera sin recortar)")

    tl = build_timeline(items, spans, audio_rel, fps=args.fps)
    tl_path = os.path.join(out_dir, "timeline.json")
    with open(tl_path, "w", encoding="utf-8") as f:
        json.dump(tl, f, indent=2, ensure_ascii=False)
    print(f"\n✅ timeline: {tl_path}  ({tl['durationInFrames'] / args.fps:.1f}s)")
    print(f"   Render:  npx remotion render ReelFromTimeline out/{name}.mp4 --props=\"{tl_path}\"\n")


if __name__ == "__main__":
    main()
