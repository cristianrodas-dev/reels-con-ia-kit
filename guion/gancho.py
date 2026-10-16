#!/usr/bin/env python3
"""
gancho.py - puntúa la primera línea de un Reel según cinco propiedades que
comparten los ganchos que retienen, y rankea varios entre sí.

Adaptación al español rioplatense de hookscore.py (instagram-agent-skill, MIT).

Qué es:  cinco heurísticas locales calculadas solo sobre el texto. Miden
propiedades que los ganchos fuertes tienden a compartir: largo decible en
menos de 3 segundos, algo concreto (número, nombre), algo en juego, la carga
al principio y no al final, y un espectador al que apuntar.

Qué NO es:  un predictor de vistas. El original fue medido contra 74 ganchos
reales: detecta bien los malos (AUC 0.83) y apenas distingue hits de fracasos
entre ganchos decentes (AUC 0.56). Usalo para matar ganchos flojos antes de
grabar; para elegir entre dos buenos, confiá en tu gráfico de retención.

Cada chequeo devuelve 0 a 100. Más es mejor.

Uso
  python3 gancho.py ganchos.txt              # uno por línea, rankeados
  python3 gancho.py --gancho "3 señales de que te hackearon Instagram."
  python3 gancho.py ganchos.txt --json
  python3 gancho.py ganchos.txt --formulas   # además clasifica por fórmula (ganchos.json)
"""

import argparse
import json
import os
import re
import statistics
import sys

WORD_RE = re.compile(r"[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9$%'’-]+")
NUMBER_RE = re.compile(
    r"\$\s?\d[\d.,]*"                                  # plata ($ es peso o dólar)
    r"|\b\d[\d.,]*\s?"                                 # cifra, con o sin unidad
    r"(?:%|k\b|x\b|hs?\b|horas?\b|min\b|minutos?\b|seg\b|segundos?\b"
    r"|días?\b|semanas?\b|meses\b|mes\b|años?\b|pesos\b|lucas\b|palos\b)?",
    re.IGNORECASE)
PROPER_RE = re.compile(r"(?<!^)\b[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}\b")
HASHTAG_RE = re.compile(r"(?:^|\s)#\w+")
EMOJI_RE = re.compile(r"[\U0001F300-\U0001FAFF☀-➿]")

# Los ganchos hablados dicen los números en voz alta. "Cero pesos" y "veinte
# lucas" son tan concretos como "$0" y "$20.000". "uno" y "primero" quedan
# afuera a propósito: son relleno mucho más seguido que cantidad.
SPOKEN_NUMBERS = {
    "cero", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
    "diez", "once", "doce", "quince", "veinte", "treinta", "cuarenta",
    "cincuenta", "sesenta", "setenta", "ochenta", "noventa", "cien", "ciento",
    "mil", "millón", "millones", "docena", "mitad", "doble", "triple",
    "segundo", "tercero", "tercera", "cuarto", "cuarta", "quinto", "quinta",
}
MONEY_WORDS = {
    "pesos", "peso", "dólares", "dólar", "euros", "lucas", "luca", "palos",
    "palo", "plata", "guita", "sueldo", "alquiler", "porciento", "ciento",
    "millonario", "facturación", "ganancia",
}

# Palabras que ponen algo en juego. Un gancho sin ninguna es una afirmación;
# con una, es una razón para seguir mirando.
STAKES = {
    # negación / corte
    "no", "nunca", "jamás", "nadie", "nada", "ni", "sin", "pero", "excepto",
    "salvo", "hasta", "antes", "todavía", "ya", "solo", "sólo", "en vez",
    "en realidad", "versus", "vs", "igual",
    # error / pérdida
    "mal", "error", "errores", "equivocado", "perdí", "perdiste", "perder",
    "perdés", "pierdes", "perdido", "perdida", "perdiendo", "cuesta", "costó",
    "costaron", "cuestan", "roto", "rota", "falló", "fallo", "falla", "fallan",
    "fracaso", "fracasé", "desperdicié", "desperdicio", "arrepentí",
    "arrepentís", "arrepiento", "ojalá", "debería", "deberías", "peor",
    # amenaza / seguridad (el nicho)
    "robaron", "robó", "roban", "robo", "robado", "robada", "hackearon",
    "hackeo", "hackean", "hackeado", "hackeada", "hackear", "estafa",
    "estafaron", "estafan", "estafador", "estafadores", "engaño", "engañan",
    "mentira", "mienten", "falso", "falsa", "falsos", "falsas", "trucho",
    "trucha", "clonaron", "clonan", "clonada", "clonado", "espían", "espiando",
    "vigilan", "interceptan", "virus", "infectado", "ataque", "atacan",
    "atacaron", "amenaza", "peligro", "peligroso", "peligrosa", "riesgo",
    "cuidado", "alerta", "advertencia", "urgente", "tarde", "bloquearon",
    "bloqueo", "bloqueada", "bloqueado", "suspendieron", "suspendida",
    "cerraron", "eliminaron", "borraron", "borrado", "borrada", "prohibido",
    "ilegal", "secreto", "oculto", "escondido", "verdad", "problema",
    "trampa", "señales", "señal", "síntoma", "síntomas",
    # acción / cambio
    "dejá", "deja", "pará", "para", "borrá", "borra", "eliminá", "elimina",
    "reemplazá", "reemplaza", "reemplazó", "gratis", "pagué", "pagaste",
    "pagan", "cobran", "cobró", "cobraron", "cortá", "corta", "renuncié",
    "echaron", "despidieron", "primero", "primera", "último", "última",
    "único", "única", "cambió", "cambia", "funcionó", "sirvió",
}

# Arranques que gastan el primer segundo sin decir nada.
WEAK_OPENERS = [
    "hola", "hey", "che", "bueno", "buenas", "buen día", "buenos días",
    "ok", "okey", "dale", "bien", "hoy", "básicamente", "honestamente",
    "la verdad", "mirá", "mira", "miren", "escuchá", "escucha", "escuchen",
    "este", "eh", "em", "les", "quiero", "quería", "les quiero", "te quiero",
    "en este", "en el video", "en el reel", "hoy les", "hoy te", "hoy vamos",
    "vamos a", "les voy", "te voy", "voy a", "una de", "la cosa", "mucha gente",
    "hay", "es que", "como", "cuando", "ya saben", "ya sabés", "ustedes",
    "chicos", "chicas", "gente", "amigos", "amigas", "bienvenidos",
    "bienvenido", "bienvenida", "soy", "me llamo", "mi nombre", "yo soy",
    "en este video", "en el día de hoy", "qué tal", "cómo están", "como están",
    "les cuento", "te cuento", "sabías", "sabían",
]

# Imperativos que se ganan el primer lugar.
IMPERATIVES = {
    "dejá", "deja", "pará", "para", "robate", "copiá", "copia", "copiate",
    "borrá", "borra", "probá", "prueba", "leé", "lee", "guardá", "guarda",
    "guardate", "usá", "usa", "hacé", "haz", "escribí", "escribe", "mandá",
    "manda", "empezá", "empieza", "nunca", "siempre", "no", "poné", "pon",
    "revisá", "revisa", "chequeá", "chequea", "activá", "activa",
    "desactivá", "desactiva", "cambiá", "cambia", "fijate", "fíjate",
    "anotá", "anota", "cerrá", "cierra", "abrí", "abre", "entrá", "entra",
    "mirá", "mira", "evitá", "evita", "cuidá", "cuida", "bloqueá", "bloquea",
    "reportá", "reporta", "denunciá", "denuncia", "apagá", "apaga",
    "sacá", "saca", "sacale", "ponele", "hacele", "mandale",
    # formas con tilde (tuteo con pronombre enclítico)
    "róbate", "cópiate", "guárdate", "llévate", "ciérralo", "ciérrala", "actívalo",
    "actívala", "revísalo", "revísala", "bórralo", "bórrala", "míralo", "mírala",
    "hazlo", "hazla", "ponlo", "ponla", "cámbiala", "cámbialo", "apágalo", "bloquéalo",
    "repórtalo", "guárdalo", "guárdala", "compártelo", "mándaselo", "pásaselo",
}

# Segunda persona: pronombres y formas verbales típicas (voseo + tuteo).
SECOND_PERSON_RE = re.compile(
    r"\b(?:te|tu|tus|vos|usted|ustedes|tuy[oa]s?|"
    r"tenés|tienes|tengas|podés|puedes|sos|eres|estás|querés|quieres|"
    r"sabés|sabes|perdiste|hiciste|usás|usas|ponés|pones|hacés|haces|"
    r"creés|crees|pensás|piensas|vendés|vendes|trabajás|trabajas|"
    r"necesitás|necesitas|abrís|abres|entrás|entras|recibís|recibes|"
    r"acordás|acuerdas|dejás|dejas|compartís|compartes|usaste|pusiste|"
    r"abriste|entraste|recibiste|compartiste|cambiaste|activaste)\b",
    re.IGNORECASE)
FIRST_PERSON_RE = re.compile(
    r"\b(?:yo|mi|mis|me|nosotros|nuestr[oa]s?|perdí|pagué|hice|tengo|tuve|"
    r"soy|estoy|cometí|aprendí|probé|usé|puse|pasé|trabajé|vi|descubrí)\b",
    re.IGNORECASE)

DEALBREAKERS = [
    (re.compile(r"(?i)^\s*(?:(?:dej[áa]|par[áa]) de (?:scrollear|deslizar)|no (?:sigas|scrollees|deslices))"),
     "Abre con \"dejá de scrollear\". Pedir atención demuestra que no la ganaste."),
    (re.compile(r"(?i)\b(?:en (?:este|el) (?:video|reel)|en el (?:video|reel) de hoy|"
                r"hoy (?:les|te) (?:voy a|quiero|vengo a) (?:mostrar|hablar|contar|explicar|enseñar)|"
                r"(?:les|te) voy a (?:mostrar|enseñar|contar|explicar))\b"),
     "Preámbulo de video. Borralo y abrí con la recompensa."),
    (re.compile(r"(?i)^\s*(?:hola|holis|buenas|buen día|buenos días|hey|che |qué tal|como están|cómo están|bienvenid)"),
     "Saludo. Nadie vino al feed a que lo saluden."),
    (HASHTAG_RE,
     "Hashtag en el gancho. Los hashtags van al final del caption, si van."),
    (EMOJI_RE,
     "Emoji en el gancho. El texto en pantalla a tamaño de gancho tiene lugar para palabras o para un emoji, no para los dos."),
]

WPS = 155 / 60.0   # ~155 palabras por minuto, castellano rioplatense hablado


def clamp(n):
    return max(0.0, min(100.0, n))


def words(text):
    # "$18.000" es una palabra cuando se dice, así que acá también.
    return WORD_RE.findall(re.sub(r"(?<=\d)[.,](?=\d{3})", "", text))


def norm(w):
    return w.lower().strip("'’")


def check_length(text):
    """El gancho tiene que aterrizar antes de que el pulgar se mueva. ~2 segundos."""
    w = words(text)
    n = len(w)
    secs = n / WPS
    chars = len(text.strip())
    if 5 <= n <= 12:
        score = 100.0
    elif n < 5:
        score = clamp(100 - (5 - n) * 20)
    else:
        score = clamp(100 - (n - 12) * 11)
    if chars > 65:                       # dos líneas de texto grande en pantalla
        score -= 12
    return clamp(score), f"{n} palabras, {chars} caracteres, ~{secs:.1f}s hablado (ideal 5-12 palabras)"


def check_specificity(text):
    """Una cosa concreta vale más que tres abstractas."""
    nums = [n.strip() for n in NUMBER_RE.findall(text) if n.strip()]
    propers = set(PROPER_RE.findall(text))
    low = [norm(w) for w in words(text)]
    spoken = [w for w in low if w in SPOKEN_NUMBERS or w in MONEY_WORDS]
    hits = len(nums) + len(propers) + len(spoken)
    score = 15.0 if hits == 0 else clamp(45 + hits * 30)
    found = ", ".join(nums[:2] + sorted(propers)[:2] + spoken[:2])
    return score, (f"{hits} marcador(es) concreto(s)" + (f": {found}" if found else
                   " - sin número, sin nombre, nada chequeable"))


def check_stakes(text):
    """Tensión, costo, negación. Algo que el espectador podría perder."""
    low = text.lower()
    w = [norm(x) for x in words(text)]
    hits = [x for x in w if x in STAKES]
    # Expresiones de dos palabras
    for phrase in ("en vez", "en realidad", "en lugar", "a tiempo", "demasiado tarde"):
        if phrase in low:
            hits.append(phrase)
    markers = sorted(set(hits))
    if re.search(r"\$\s?\d", text):
        markers.append("un precio")
    n = len(markers)
    score = {0: 20.0, 1: 70.0}.get(n, 100.0)
    detail = f"{n} marcador(es) de tensión" + (f": {', '.join(markers[:4])}" if markers else
                                              " - no hay nada en juego en esta línea")
    return clamp(score), detail


def check_frontload(text):
    """La palabra interesante no puede estar en la posición nueve."""
    w = words(text)
    if not w:
        return 0.0, "vacío"
    low = [norm(x) for x in w]
    opener = " ".join(low[:3])
    penalty = 0
    hit_opener = None
    for weak in WEAK_OPENERS:
        if opener.startswith(weak + " ") or opener == weak or low[0] == weak:
            penalty, hit_opener = 30, weak
            break
    payload = None
    for i, token in enumerate(low):
        if (token in STAKES or token in SPOKEN_NUMBERS or token in MONEY_WORDS
                or NUMBER_RE.match(w[i]) or (i and PROPER_RE.match(w[i]))):
            payload = i
            break
    if payload is None:
        base = 30.0
        where = "no hay palabra con carga en toda la línea"
    elif payload <= 3:
        base = 100.0
        where = f"carga en la palabra {payload + 1}"
    elif payload <= 6:
        base = 70.0
        where = f"carga en la palabra {payload + 1}, podría ir antes"
    else:
        base = 40.0
        where = f"carga en la palabra {payload + 1}, demasiado tarde"
    detail = where + (f"; arranque flojo \"{hit_opener}\"" if hit_opener else "")
    return clamp(base - penalty), detail


def check_address(text):
    """Apuntado a un espectador, o flotando en el aire."""
    w = [norm(x) for x in words(text)]
    if SECOND_PERSON_RE.search(text):
        return 100.0, "le habla al espectador"
    if w and w[0] in IMPERATIVES:
        return 90.0, f"abre con imperativo (\"{w[0]}\")"
    if FIRST_PERSON_RE.search(text):
        return 70.0, "primera persona, sin nombrar al espectador"
    return 35.0, "tercera persona, no hay nadie en la sala"


CHECKS = ["LARGO", "CONCRETO", "EN JUEGO", "CARGA", "A QUIÉN"]


def run(text):
    results = {
        "LARGO": check_length(text),
        "CONCRETO": check_specificity(text),
        "EN JUEGO": check_stakes(text),
        "CARGA": check_frontload(text),
        "A QUIÉN": check_address(text),
    }
    flags = [msg for pattern, msg in DEALBREAKERS if pattern.search(text)]
    scores = [results[c][0] for c in CHECKS]
    # La propiedad más floja limita al gancho: una sola mala alcanza para que
    # el pulgar siga.
    overall = statistics.mean(scores) * 0.6 + min(scores) * 0.4 - len(flags) * 15
    overall = clamp(overall)
    verdict = "FUERTE" if overall >= 70 and min(scores) >= 55 and not flags else (
        "OK" if overall >= 50 else "FLOJO")
    return results, overall, verdict, flags


def classify(text, formulas):
    """Nombra la fórmula de ganchos.json que coincide, si alguna."""
    for f in formulas:
        try:
            if re.search(f["match"], text, re.IGNORECASE):
                return f"#{f['id']} {f['nombre']}"
        except re.error:
            continue
    return None


def load_formulas():
    here = os.path.dirname(os.path.abspath(__file__))
    p = os.path.join(here, "ganchos.json")
    if not os.path.exists(p):
        return []
    data = json.load(open(p, encoding="utf-8"))
    order = data.get("orden_clasificacion") or [f["id"] for f in data["formulas"]]
    by_id = {f["id"]: f for f in data["formulas"]}
    return [by_id[i] for i in order if i in by_id]


def bar(score, width=24):
    filled = round(score / 100 * width)
    return "#" * filled + "." * (width - filled)


def render_one(text, results, overall, verdict, flags, formula=None, out=sys.stdout):
    print("\nPUNTAJE DEL GANCHO", file=out)
    print("=" * 62, file=out)
    print(f"  \"{text.strip()}\"\n", file=out)
    for name in CHECKS:
        score, detail = results[name]
        print(f"  {name:<13} {bar(score)} {score:5.1f}", file=out)
        print(f"  {'':<13} {detail}", file=out)
    print("-" * 62, file=out)
    print(f"  {'PUNTAJE':<13} {bar(overall)} {overall:5.1f}   {verdict}", file=out)
    if formula:
        print(f"  {'FÓRMULA':<13} {formula}", file=out)
    for f in flags:
        print(f"\n  MATA-GANCHO  {f}", file=out)
    if verdict != "FUERTE":
        weakest = min(CHECKS, key=lambda c: results[c][0])
        print(f"\n  Propiedad más floja: {weakest}. Arreglá esa y volvé a correr.", file=out)
    print("", file=out)


def render_table(rows, out=sys.stdout):
    print("\nRANKING DE GANCHOS\n" + "=" * 78, file=out)
    for i, r in enumerate(rows, 1):
        mark = "->" if i == 1 else "  "
        hook = r["gancho"] if len(r["gancho"]) <= 62 else r["gancho"][:59] + "..."
        print(f"{mark} {r['puntaje']:5.1f} {r['veredicto']:<7} {hook}", file=out)
        extra = f"        más flojo: {r['mas_flojo']} ({r['chequeos'][r['mas_flojo']]['puntaje']:.0f})"
        if r.get("formula"):
            extra += f"   ·   fórmula {r['formula']}"
        print(extra, file=out)
        for f in r["flags"]:
            print(f"        mata-gancho: {f}", file=out)
    print("\nGrabá el primero. Si el primero está abajo de 50, ninguno es el gancho.\n",
          file=out)


def main():
    ap = argparse.ArgumentParser(description="Puntúa el gancho de un Reel en cinco propiedades.")
    ap.add_argument("input", nargs="?", default="-", help="archivo con un gancho por línea, o -")
    ap.add_argument("--gancho", "--hook", dest="gancho", help="puntúa un solo gancho dado por línea de comando")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--formulas", action="store_true", help="clasifica cada gancho por fórmula (ganchos.json)")
    args = ap.parse_args()

    if args.gancho:
        lines = [args.gancho]
    else:
        raw = sys.stdin.read() if args.input == "-" else open(args.input, encoding="utf-8").read()
        lines = [l.strip() for l in raw.splitlines() if l.strip()]
    if not lines:
        print("nada que puntuar", file=sys.stderr)
        sys.exit(2)

    formulas = load_formulas() if (args.formulas or args.json) else []

    payload = []
    for line in lines:
        results, overall, verdict, flags = run(line)
        payload.append({
            "gancho": line,
            "chequeos": {k: {"puntaje": round(v[0], 1), "detalle": v[1]} for k, v in results.items()},
            "mas_flojo": min(CHECKS, key=lambda c: results[c][0]),
            "flags": flags,
            "puntaje": round(overall, 1),
            "veredicto": verdict,
            "formula": classify(line, formulas) if formulas else None,
        })

    if args.json:
        print(json.dumps(payload if len(payload) > 1 else payload[0], indent=2, ensure_ascii=False))
        return

    if len(payload) == 1:
        results, overall, verdict, flags = run(lines[0])
        render_one(lines[0], results, overall, verdict, flags, payload[0]["formula"])
    else:
        render_table(sorted(payload, key=lambda r: -r["puntaje"]))

    sys.exit(0 if max(p["puntaje"] for p in payload) >= 70 else 1)


if __name__ == "__main__":
    main()
