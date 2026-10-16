#!/usr/bin/env python3
"""
caption.py - revisa el caption de un post de Instagram y muestra exactamente
lo que el feed enseña antes del "... más".

Adaptación al español de caption.py (instagram-agent-skill, MIT).

Instagram muestra ~125 caracteres del caption en el feed y esconde el resto
detrás de un toque. Casi todos los captions que fallan, fallan ahí: el gancho
está en la tercera oración, la primera línea es un saludo, o abre con un
hashtag. Esto imprime la ventana visible como una caja, para leerla como la
lee un desconocido scrolleando, y después chequea lo que vale la pena chequear.

Uso
  python3 caption.py caption.txt
  python3 caption.py caption.txt --keywords "cuenta hackeada,recuperar instagram"
  python3 caption.py caption.txt --json
"""

import argparse
import json
import re
import sys
import textwrap

LIMIT = 2200             # Límite duro de Instagram.
TRUNCATE = 125           # Aprox. donde el feed corta a "... más".
HASHTAG_LIMIT = 5        # Tope por post desde dic 2025 (antes 30).

HASHTAG_RE = re.compile(r"(?:^|\s)(#[A-Za-z0-9_áéíóúñÁÉÍÓÚÑ]+)")
MENTION_RE = re.compile(r"(?:^|\s)(@[A-Za-z0-9_.]+)")
LINK_RE = re.compile(r"https?://\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|co|io|net|org|ai|app|ar)/\S*",
                     re.IGNORECASE)
EMOJI_RE = re.compile(r"[\U0001F300-\U0001FAFF☀-➿←-⇿️]")
CONCRETE_RE = re.compile(
    r"\$\s?\d|\b\d[\d.,]*\b|(?<!^)\b[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}\b"
    r"|(?i:\b(?:dos|tres|cuatro|cinco|seis|siete|diez|quince|veinte|cien|mil)\b)",
    re.MULTILINE)

ASKS = [
    (re.compile(r"(?i)\b(?:coment(?:á|a|en|ame)|escr[ií]b\w*|mand(?:á|a|ame)|pon(?:é|e)|dej(?:á|a))\b[^.!?\n]{0,25}\b[\"“]?[A-ZÁÉÍÓÚÑ0-9]{2,}[\"”]?"),
     "comentar/escribir una palabra clave"),
    (re.compile(r"(?i)\b(?:m[aá]ndame|escr[ií]b[ei]me|h[aá]blame|env[ií]ame)\b[^.!?\n]{0,30}\b(?:dm|mensaje|md|privado)\b"), "mandar DM"),
    (re.compile(r"(?i)\bguard(?:á|a|alo|ala|en|atelo)\b"), "guardar"),
    (re.compile(r"(?i)\bcompart(?:í|e|ilo|ila|an|elo|ela)\b|\bm[aá]nd(?:á|a)selo\b|\bp[aá]s(?:á|a)selo\b|\betiquet(?:á|a) a\b"), "compartir"),
    (re.compile(r"(?i)\bsegu(?:í|i)(?:me|nos)?\b|\bseguime\b"), "seguir"),
    (re.compile(r"(?i)\blink en (?:la |mi )?bio\b"), "link en bio"),
    (re.compile(r"(?i)\bdesliz(?:á|a)\b|\btoc(?:á|a)\b"), "deslizar o tocar"),
    (re.compile(r"(?i)\bcontame\b|\bqué (?:harías|opinás|pensás)\b|\bcuál (?:usás|elegís)\b"), "responder una pregunta"),
]

FILLER_TAGS = {"#viral", "#fyp", "#explore", "#explorepage", "#foryou", "#foryoupage",
               "#parati", "#parati", "#trending", "#instagood", "#love", "#follow",
               "#like4like", "#reels", "#reelsinstagram", "#viralreels", "#instadaily",
               "#reel", "#viralvideo", "#fypシ", "#tendencia", "#argentina"}


def visible_window(text, cut):
    flat = text.strip()
    return flat if len(flat) <= cut else flat[:cut]


def render_box(window, truncated, out=sys.stdout, width=52):
    print("\n  LO QUE MUESTRA EL FEED", file=out)
    print("  +" + "-" * (width + 2) + "+", file=out)
    lines = []
    for raw in window.split("\n"):
        lines.extend(textwrap.wrap(raw, width) or [""])
    for line in lines[:8]:
        print(f"  | {line:<{width}} |", file=out)
    tail = "... más" if truncated else "(entra entero)"
    print("  +" + "-" * (width + 2 - len(tail) - 2) + f" {tail} " + "+", file=out)


def analyse(text, cut=TRUNCATE, keywords=None):
    text = text.rstrip()
    stripped = text.strip()
    chars = len(stripped)
    lines = [l for l in stripped.split("\n")]
    first_line = lines[0].strip() if lines else ""
    tags = HASHTAG_RE.findall(stripped)
    mentions = MENTION_RE.findall(stripped)
    links = LINK_RE.findall(stripped)
    emoji = EMOJI_RE.findall(stripped)
    window = visible_window(stripped, cut)
    truncated = chars > cut
    # Pedidos por oración; "escríbeme SOS por mensaje" es UN pedido, no dos.
    asks = []
    for sent in re.split(r"(?<=[.!?])\s+|\n+", stripped):
        found = [name for pattern, name in ASKS if pattern.search(sent)]
        if "comentar/escribir una palabra clave" in found and "mandar DM" in found:
            found.remove("mandar DM")
        for n in found:
            if n not in asks:
                asks.append(n)
    filler = [t for t in tags if t.lower() in FILLER_TAGS]
    keywords = [k.strip() for k in (keywords or []) if k.strip()]

    checks = []

    def add(name, status, detail):
        checks.append({"check": name, "status": status, "detail": detail})

    add("LARGO", "FALLA" if chars > LIMIT else "OK",
        f"{chars} / {LIMIT} caracteres" + (f", {chars - LIMIT} de más" if chars > LIMIT else ""))

    if not first_line:
        add("PRIMERA LÍNEA", "FALLA", "el caption abre con una línea vacía")
    elif first_line.startswith("#") or first_line.startswith("@"):
        add("PRIMERA LÍNEA", "FALLA",
            "abre con hashtag o mención, que es el único lugar que vale una oración")
    elif re.match(r"(?i)^\s*(hola|buenas|hey|bienvenid)", first_line):
        add("PRIMERA LÍNEA", "FALLA", "abre con un saludo; nadie vino al feed a que lo saluden")
    elif len(first_line) > cut:
        add("PRIMERA LÍNEA", "OJO",
            f"{len(first_line)} caracteres, se corta en {cut} a mitad de idea. "
            "Bien si el corte es un cliffhanger, mal si es una subordinada")
    else:
        add("PRIMERA LÍNEA", "OK", f"{len(first_line)} caracteres, entra entera")

    add("GANCHO CONCRETO", "OK" if CONCRETE_RE.search(window) else "OJO",
        f"{len(CONCRETE_RE.findall(window))} número(s) o nombre(s) en la ventana visible"
        + ("" if CONCRETE_RE.search(window) else " - nada chequeable antes del toque"))

    if len(tags) > HASHTAG_LIMIT:
        add("HASHTAGS", "FALLA", f"{len(tags)} tags, pasa el tope de {HASHTAG_LIMIT} de Instagram. "
                                 "Del sexto en adelante no cuentan y el bloque se ve viejo")
    elif len(tags) == HASHTAG_LIMIT and filler:
        add("HASHTAGS", "OJO", f"{len(tags)} tags, al tope, y {len(filler)} genérico(s). "
                               "Gastá los cinco en temas")
    elif filler:
        add("HASHTAGS", "OJO", f"{len(tags)} tags, {len(filler)} genérico(s) "
                               f"({', '.join(filler[:3])}). Esos no describen nada")
    else:
        add("HASHTAGS", "OK", f"{len(tags)} tag(s)" + (f": {' '.join(tags)}" if tags else ""))

    if not tags:
        add("UBICACIÓN TAGS", "OK", "no hay tags que ubicar")
    elif any(re.search(r"(?:^|\s)" + re.escape(t) + r"\b", window) for t in tags):
        add("UBICACIÓN TAGS", "OJO", "hay un hashtag dentro de la ventana visible, "
                                     "gastando espacio del feed en una etiqueta")
    else:
        add("UBICACIÓN TAGS", "OK", "los tags están abajo del pliegue")

    add("LINKS", "OJO" if links else "OK",
        f"{len(links)} link(s) en el caption, y los captions no son clickeables. "
        f"Movelo a la bio o al DM" if links else "sin links muertos en el cuerpo")

    if len(asks) == 1:
        add("UN SOLO PEDIDO", "OK", f"un llamado a la acción: {asks[0]}")
    elif not asks:
        add("UN SOLO PEDIDO", "OJO", "sin llamado a la acción. Decidí para qué es este post")
    else:
        add("UN SOLO PEDIDO", "OJO", f"{len(asks)} pedidos ({', '.join(asks)}). "
                                     "Dos pedidos es lo mismo que ninguno")

    density = len(emoji) * 100 / max(chars, 1)
    add("EMOJI", "OJO" if density > 4 else "OK",
        f"{len(emoji)} emoji, {density:.1f} cada 100 caracteres"
        + (" - se lee como decoración" if density > 4 else ""))

    if keywords:
        low = stripped.lower()
        found = [k for k in keywords if k.lower() in low]
        missing = [k for k in keywords if k.lower() not in low]
        in_window = [k for k in found if k.lower() in window.lower()]
        status = "OK" if not missing else ("OJO" if found else "FALLA")
        add("TÉRMINOS DE BÚSQUEDA", status,
            f"{len(found)}/{len(keywords)} presentes"
            + (f", {len(in_window)} en la ventana visible" if found else "")
            + (f". Faltan: {', '.join(missing)}" if missing else ""))

    fails = sum(1 for c in checks if c["status"] == "FALLA")
    warns = sum(1 for c in checks if c["status"] == "OJO")
    verdict = "CORREGIR" if fails else ("REVISAR" if warns else "LISTO")

    return {
        "caracteres": chars, "limite": LIMIT, "corte": cut,
        "visible": window, "truncado": truncated,
        "primera_linea_chars": len(first_line),
        "hashtags": tags, "menciones": mentions, "links": links,
        "emoji": len(emoji), "pedidos": asks,
        "chequeos": checks, "veredicto": verdict,
    }


def render(a, out=sys.stdout):
    head = (f"CAPTION  ·  {a['caracteres']} / {a['limite']} caracteres  ·  "
            f"{len(a['hashtags'])} hashtags  ·  {len(a['pedidos'])} pedido(s)")
    print("\n" + head, file=out)
    print("=" * max(len(head), 62), file=out)
    render_box(a["visible"], a["truncado"], out=out)
    print("", file=out)
    for c in a["chequeos"]:
        print(f"  {c['status']:<6} {c['check']:<20} {c['detail']}", file=out)
    print("-" * max(len(head), 62), file=out)
    print(f"  VEREDICTO  {a['veredicto']}\n", file=out)


def main():
    ap = argparse.ArgumentParser(description="Revisa un caption de Instagram.")
    ap.add_argument("input", nargs="?", default="-", help="archivo del caption, o - para stdin")
    ap.add_argument("--truncate", type=int, default=TRUNCATE,
                    help=f"caracteres visibles antes de '... más' (default {TRUNCATE})")
    ap.add_argument("--keywords", default="", help="términos separados por coma por los que querés que te encuentren")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    raw = sys.stdin.read() if args.input == "-" else open(args.input, encoding="utf-8").read()
    a = analyse(raw, cut=args.truncate, keywords=args.keywords.split(","))
    if args.json:
        print(json.dumps(a, indent=2, ensure_ascii=False))
    else:
        render(a)
    sys.exit(0 if a["veredicto"] == "LISTO" else 1)


if __name__ == "__main__":
    main()
