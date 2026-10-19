#!/usr/bin/env python3
"""
beats.py - convierte el guión de un Reel en una hoja de tiempos antes de
producirlo, y la exporta como línea de tiempo para Remotion.

Adaptación al español de beats.py (instagram-agent-skill, MIT) + exportación
a Remotion.

Estima cuánto tarda cada línea en decirse, las apila en códigos de tiempo y
marca las cuatro cosas que matan un Reel en la edición: un gancho que pasa
los 3 segundos, un beat tan largo que el espectador se va, una seguidilla de
líneas sin nada concreto, y un largo total que no coincide con el objetivo.

Formato del guión (un beat por línea):

    3 señales de que te hackearon Instagram.
    > 3 SEÑALES DE HACKEO
    La primera: te llega un mail de "cambio de contraseña" que no pediste.
    > 1. MAIL QUE NO PEDISTE
    ...

Las líneas que empiezan con ">" son texto en pantalla del beat anterior.
No se hablan, no suman tiempo, y van al JSON de Remotion como `onScreen`.

Las líneas que empiezan con "@" son instrucciones de video del beat anterior:
    @paso 1/3            contador rojo "1/3" bajo la marca (queda fijo hasta el siguiente)
    @mail remitente      mail de ejemplo con el remitente resaltado (también: apuro, link, nada)

Uso
  python3 beats.py guion.txt
  python3 beats.py guion.txt --target 20
  python3 beats.py guion.txt --wpm 165 --target 30
  python3 beats.py guion.txt --remotion > timeline.json     # para Remotion
  python3 beats.py guion.txt --json
"""

import argparse
import json
import re
import sys

WORD_RE = re.compile(r"[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9$%'’-]+")
SENT_RE = re.compile(r"[^.!?]+[.!?]*")
CONCRETE_RE = re.compile(
    r"\$\s?\d|\b\d[\d.,]*\b|(?<!^)\b[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}\b"
    # números dichos en voz alta también cuentan como concretos
    r"|(?i:\b(?:cero|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|quince|veinte|"
    r"treinta|cincuenta|cien|mil|millón|millones|mitad|doble|triple|"
    r"segund[oa]|tercer[oa]|cuart[oa]|quint[oa])\b)",
    re.MULTILINE)
STOPWORDS = {
    "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "o", "pero",
    "si", "de", "del", "a", "al", "en", "por", "para", "con", "sin", "que",
    "qué", "esto", "esta", "este", "eso", "esa", "ese", "es", "son", "era",
    "fue", "ser", "estar", "está", "están", "te", "tu", "tus", "vos", "yo",
    "mi", "mis", "me", "nos", "nuestro", "nuestra", "ellos", "ellas", "él",
    "ella", "se", "su", "sus", "le", "les", "lo", "no", "ya", "más", "muy",
    "hay", "ha", "han", "tiene", "tienen", "tenés", "tenemos", "puede",
    "pueden", "podés", "como", "cómo", "cuando", "cuándo", "donde", "dónde",
    "todo", "todos", "toda", "todas", "uno", "dos", "ahora", "hoy", "así",
    "acá", "ahí", "bien", "mal", "algo", "alguien", "nada", "nadie",
}

HOOK_WINDOW = 3.0        # segundos. Pasado esto, el pulgar ya decidió.
MAX_BEAT = 4.0           # segundos en una idea sin cambio en pantalla.
ABSTRACT_RUN = 3         # beats seguidos sin nada chequeable.
FPS = 30                 # fps del proyecto Remotion


def words(text):
    return WORD_RE.findall(re.sub(r"(?<=\d)[.,](?=\d{3})", "", text))


def pretty(token):
    return re.sub(r"(\d)(?=(\d{3})+$)", r"\1.", token)


def tc(seconds):
    m, s = divmod(seconds, 60)
    return f"{int(m)}:{s:04.1f}"


def parse_script(raw):
    """Devuelve [(linea_hablada, [textos_en_pantalla])]."""
    out = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith(">"):
            if out:
                out[-1][1].append(line.lstrip("> ").strip())
            continue
        if line.startswith("@"):
            continue  # instrucción de video: la lee parse_extras
        out.append([line, []])
    return out


MAIL_HIGHLIGHT = {"remitente": "sender", "apuro": "urgency", "link": "link", "nada": "none"}


def parse_extras(raw):
    """Una entrada por línea hablada con las instrucciones "@" que la siguen.

    Devuelve dicts listos para mezclar en cada beat del JSON de Remotion:
    {"step": "1/3"} y/o {"visual": {"type": "fakeMail", "highlight": "sender"}}.
    """
    out = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith(">"):
            continue
        if not line.startswith("@"):
            out.append({})
            continue
        if not out:
            continue
        cmd, _, arg = line[1:].strip().partition(" ")
        cmd, arg = cmd.lower(), arg.strip().lower()
        if cmd == "paso" and re.fullmatch(r"\d{1,2}/\d{1,2}", arg):
            out[-1]["step"] = arg
        elif cmd == "mail":
            out[-1]["visual"] = {"type": "fakeMail", "highlight": MAIL_HIGHLIGHT.get(arg, "none")}
        else:
            print(f"⚠️  instrucción desconocida ignorada: {line}", file=sys.stderr)
    return out


def apply_extras(beats, extras):
    """Agrega step/visual a cada beat (mismo orden que las líneas habladas)."""
    for beat, extra in zip(beats, extras):
        beat.update(extra)
    return beats


def split_beats(items, wps):
    """Una línea es un beat, salvo que sea demasiado larga para serlo."""
    beats = []
    for line, screen in items:
        if len(words(line)) / wps <= MAX_BEAT * 1.5:
            beats.append((line, screen, False))
            continue
        parts = [p.strip() for p in SENT_RE.findall(line) if p.strip()]
        buf = ""
        first = True
        for part in parts:
            candidate = (buf + " " + part).strip()
            if buf and len(words(candidate)) / wps > MAX_BEAT:
                beats.append((buf, screen if first else [], True))
                first = False
                buf = part
            else:
                buf = candidate
        if buf:
            beats.append((buf, screen if first else [], True))
    return beats


def analyse(raw, wpm=155, target=None):
    wps = wpm / 60.0
    beats = split_beats(parse_script(raw), wps)
    if not beats:
        return None

    rows, clock = [], 0.0
    for i, (text, screen, was_split) in enumerate(beats):
        n = len(words(text))
        dur = n / wps
        rows.append({
            "n": i + 1,
            "start": round(clock, 2),
            "dur": round(dur, 2),
            "words": n,
            "text": text,
            "on_screen": screen,
            "concrete": len(CONCRETE_RE.findall(text)),
            "label": "",
            "flags": ["línea larga, dividida automáticamente"] if was_split else [],
        })
        clock += dur
    total = clock

    for r in rows:
        if r["n"] == 1 or r["start"] + r["dur"] <= HOOK_WINDOW:
            r["label"] = "GANCHO"
    rows[-1]["label"] = "CTA" if rows[-1]["label"] != "GANCHO" else "GANCHO/CTA"
    half = total / 2
    for r in rows:
        if not r["label"] and r["start"] <= half < r["start"] + r["dur"]:
            r["label"] = "MEDIO"

    notes = []
    if rows[0]["dur"] > HOOK_WINDOW:
        rows[0]["flags"].append(f"el gancho dura {rows[0]['dur']:.1f}s, pasa la marca de {HOOK_WINDOW:.0f}s")
        notes.append(f"El beat 1 tarda {rows[0]['dur']:.1f}s en decirse. Cortalo a "
                     f"{int(HOOK_WINDOW * wps)} palabras o menos, o el gancho llega después "
                     "de que el pulgar decidió.")
    if rows[0]["concrete"] == 0:
        notes.append("El beat 1 no tiene ni número ni nombre. Los ganchos sin algo "
                     "chequeable son los que se scrollean.")
    if not rows[0]["on_screen"]:
        notes.append("El gancho no tiene texto en pantalla (línea con '>'). Se lee antes "
                     "de escucharse: el 80% mira sin sonido al principio.")

    for r in rows:
        if r["dur"] > MAX_BEAT:
            r["flags"].append(f"{r['dur']:.1f}s en un solo beat")
    long_beats = [r["n"] for r in rows if r["dur"] > MAX_BEAT]
    if long_beats:
        notes.append(f"Beat(s) {', '.join(map(str, long_beats))} pasan los {MAX_BEAT:.0f}s. "
                     "Dividí la línea o cambiá lo que hay en pantalla adentro del beat. "
                     "Un plano quieto es donde la gente se va.")

    run, start = 0, None
    for r in rows:
        if r["concrete"] == 0:
            run += 1
            start = start if start is not None else r["n"]
            if run == ABSTRACT_RUN:
                notes.append(f"Los beats {start}-{r['n']} no tienen nada concreto. "
                             "Metele un número, un nombre o un precio a alguno.")
        else:
            run, start = 0, None

    first = {w.lower() for w in words(rows[0]["text"]) if w.lower() not in STOPWORDS}
    last = {w.lower() for w in words(rows[-1]["text"]) if w.lower() not in STOPWORDS}
    loop = sorted(pretty(w) for w in first & last)
    if loop:
        notes.append(f"Loop: el último beat repite \"{', '.join(loop[:3])}\" del gancho. "
                     "Las segundas vistas son alcance gratis.")
    else:
        notes.append("Sin loop. El último beat no comparte ninguna palabra con el gancho, "
                     "así que el video termina plano. Repetir una palabra del beat 1 es "
                     "la repetición más barata que existe.")

    if target:
        delta = total - target
        if abs(delta) <= target * 0.1:
            notes.append(f"Largo en objetivo ({total:.1f}s contra {target}s).")
        elif delta > 0:
            notes.append(f"{delta:.1f}s por encima del objetivo. Cortá unas {int(delta * wps)} palabras.")
        else:
            notes.append(f"{-delta:.1f}s por debajo del objetivo. Agregá {int(-delta * wps)} palabras "
                         "o grabalo corto. Corto suele ser lo correcto.")

    return {
        "wpm": wpm, "target": target,
        "total_seconds": round(total, 2),
        "total_words": sum(r["words"] for r in rows),
        "beats": rows,
        "notes": notes,
    }


def to_remotion(a, fps=FPS, tail_seconds=0.6):
    """Línea de tiempo lista para <Sequence from durationInFrames>."""
    seqs = []
    for r in a["beats"]:
        frm = round(r["start"] * fps)
        dur = max(1, round(r["dur"] * fps))
        seqs.append({
            "id": f"beat-{r['n']}",
            "label": r["label"] or "CUERPO",
            "from": frm,
            "durationInFrames": dur,
            "spoken": r["text"],
            "onScreen": r["on_screen"],
        })
    total_frames = round(a["total_seconds"] * fps) + round(tail_seconds * fps)
    return {
        "fps": fps,
        "width": 1080,
        "height": 1920,
        "durationInFrames": total_frames,
        "safeZone": {"top": 230, "bottom": 1440, "left": 120, "right": 960},
        "beats": seqs,
    }


def render(a, out=sys.stdout):
    head = (f"HOJA DE BEATS  ·  {a['total_words']} palabras  ·  ~{a['total_seconds']:.1f}s "
            f"a {a['wpm']} ppm" + (f"  ·  objetivo {a['target']}s" if a["target"] else ""))
    print("\n" + head, file=out)
    print("=" * max(len(head), 72), file=out)
    for r in a["beats"]:
        label = f"{r['label']:<10}" if r["label"] else " " * 10
        print(f"  {tc(r['start'])}  {r['dur']:4.1f}s  {label}{r['text']}", file=out)
        for s in r["on_screen"]:
            print(f"  {'':>6}  {'':>5}  {'':<10}  [pantalla] {s}", file=out)
        for f in r["flags"]:
            print(f"  {'':>6}  {'':>5}  {'':<10}^ {f}", file=out)
    print("-" * max(len(head), 72), file=out)
    for n in a["notes"]:
        print(f"  - {n}", file=out)
    print("", file=out)


def main():
    ap = argparse.ArgumentParser(description="Convierte el guión de un Reel en hoja de beats.")
    ap.add_argument("input", nargs="?", default="-", help="archivo del guión, o - para stdin")
    ap.add_argument("--wpm", type=float, default=155, help="velocidad de habla (default 155 ppm)")
    ap.add_argument("--target", type=float, help="largo objetivo en segundos")
    ap.add_argument("--fps", type=int, default=FPS, help="fps del proyecto Remotion (default 30)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--remotion", action="store_true", help="exporta la línea de tiempo para Remotion (JSON)")
    args = ap.parse_args()

    raw = sys.stdin.read() if args.input == "-" else open(args.input, encoding="utf-8").read()
    a = analyse(raw, wpm=args.wpm, target=args.target)
    if not a:
        print("guión vacío", file=sys.stderr)
        sys.exit(2)
    if args.remotion:
        print(json.dumps(to_remotion(a, fps=args.fps), indent=2, ensure_ascii=False))
    elif args.json:
        print(json.dumps(a, indent=2, ensure_ascii=False))
    else:
        render(a)
    sys.exit(0)


if __name__ == "__main__":
    main()
