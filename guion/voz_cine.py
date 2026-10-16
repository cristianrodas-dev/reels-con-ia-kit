#!/usr/bin/env python3
"""
voz_cine.py - procesa la voz de un Reel para que suene "de tráiler" sin perder claridad.

Cadena (ffmpeg): corte de rumble -> cuerpo en graves (120 Hz) -> presencia (3,5 kHz)
-> compresión -> eco corto de sala -> normalización a -14 LUFS (estándar de redes).

Uso
  python voz_cine.py ../video/public/voz/dia01-cookie
  (procesa beat-*.mp3/.wav de esa carpeta y actualiza timeline.json para usar los nuevos)
"""
import glob
import json
import os
import shutil
import subprocess
import sys

CHAIN = (
    "highpass=f=75,"
    "equalizer=f=120:t=q:w=1.0:g=4,"
    "equalizer=f=3500:t=q:w=1.2:g=2.5,"
    "acompressor=threshold=-20dB:ratio=3.5:attack=4:release=90:makeup=2,"
    "aecho=0.85:0.5:38|71:0.12|0.07"
)
# loudnorm en una pasada falla con clips cortos (<3 s): los deja ~15 dB más bajos.
# Por eso se normaliza en dos pasadas: medir y después corregir con los valores medidos.
TARGET_I, TARGET_TP = -14.0, -1.5


def find_ffmpeg():
    p = shutil.which("ffmpeg")
    if p:
        return p
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.normpath(os.path.join(here, "..", "video", "node_modules", "@remotion"))
    if os.path.isdir(root):
        for d in os.listdir(root):
            for n in ("ffmpeg.exe", "ffmpeg"):
                c = os.path.join(root, d, n)
                if d.startswith("compositor-") and os.path.exists(c):
                    return c
    raise SystemExit("No encontré ffmpeg.")


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    folder = os.path.abspath(sys.argv[1])
    ff = find_ffmpeg()
    clips = sorted(c for c in glob.glob(os.path.join(folder, "beat-*.*"))
                   if "-cine" not in c and c.lower().endswith((".mp3", ".wav")))
    if not clips:
        raise SystemExit("No hay clips beat-* en esa carpeta.")
    renamed = {}
    for c in clips:
        base, _ = os.path.splitext(c)
        out = base + "-cine.mp3"
        # pasada 1: medir el volumen del clip ya procesado
        meas = subprocess.run([ff, "-v", "info", "-i", c, "-af", CHAIN + ",loudnorm=print_format=json",
                               "-f", "null", "-"], capture_output=True, text=True).stderr
        import re
        m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", meas, re.S)
        info = json.loads(m.group(0)) if m else {}
        gain = TARGET_I - float(info.get("input_i", -14.0))
        tp = float(info.get("input_tp", -1.5))
        gain = min(gain, TARGET_TP - tp)   # nunca pasar el pico permitido
        # pasada 2: aplicar la ganancia exacta y limitar picos
        af = CHAIN + f",volume={gain:.2f}dB,alimiter=limit=0.84:attack=3:release=60:level=false"
        subprocess.run([ff, "-y", "-v", "error", "-i", c, "-af", af, "-ar", "44100",
                        "-c:a", "libmp3lame", "-q:a", "2", out], check=True)
        renamed[os.path.basename(c)] = os.path.basename(out)
        print(f"  🎚  {os.path.basename(c)} → {os.path.basename(out)}  ({gain:+.1f} dB)")
    tl_path = os.path.join(folder, "timeline.json")
    if os.path.exists(tl_path):
        tl = json.load(open(tl_path, encoding="utf-8"))
        for b in tl.get("beats", []):
            a = b.get("audio")
            if a and os.path.basename(a) in renamed:
                b["audio"] = a.rsplit("/", 1)[0] + "/" + renamed[os.path.basename(a)]
        tl["voice"] = {**tl.get("voice", {}), "post": "cine"}
        json.dump(tl, open(tl_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        print(f"\n✅ timeline.json actualizado para usar la voz procesada.")


if __name__ == "__main__":
    main()
