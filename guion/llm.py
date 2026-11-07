#!/usr/bin/env python3
"""Genera ganchos y guion de un Reel con una API de LLM gratuita (sin dependencias).

Proveedores:
  gemini (default)  Google AI Studio, capa gratis. GEMINI_API_KEY en el .env
                    (clave en https://aistudio.google.com/apikey). Modelo: GEMINI_MODEL
  groq              Groq, capa gratis. GROQ_API_KEY en el .env. Modelo: GROQ_MODEL

Uso:
  python llm.py "por qué la mayoría abandona el gimnasio en febrero"
  python llm.py "idea" --provider groq --duracion 45 --salida guion.txt

Si existe guion/voice.md se usa como descripción de tu voz y estilo.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

PROMPT = """Eres guionista de Reels de Instagram en español.
{voz}
Idea: {idea}
Duración objetivo: {dur} segundos (~{palabras} palabras habladas).

Entrega, en este orden y sin explicaciones extra:
1) GANCHOS: 3 opciones de máximo 12 palabras, cada una con un puntaje 1-10 y una razón corta.
2) GUION: texto hablado corrido, frases cortas, sin indicaciones de cámara, empezando con el mejor gancho.
3) CAPTION: máximo 3 líneas, más 5 hashtags.
"""


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


def get(name, env, default=None):
    return os.environ.get(name) or env.get(name) or default


def post(url, headers, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "replace")[:400]
        raise SystemExit(f"❌ {url.split('/')[2]} {e.code} — {msg}")


def gemini(prompt, env):
    key = get("GEMINI_API_KEY", env)
    if not key:
        raise SystemExit("Falta GEMINI_API_KEY en el .env (https://aistudio.google.com/apikey).")
    model = get("GEMINI_MODEL", env, "gemini-2.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    data = post(url, {"Content-Type": "application/json", "x-goog-api-key": key},
                {"contents": [{"parts": [{"text": prompt}]}]})
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        raise SystemExit(f"Respuesta inesperada de Gemini: {json.dumps(data)[:400]}")


def groq(prompt, env):
    key = get("GROQ_API_KEY", env)
    if not key:
        raise SystemExit("Falta GROQ_API_KEY en el .env (https://console.groq.com/keys).")
    model = get("GROQ_MODEL", env, "llama-3.3-70b-versatile")
    data = post("https://api.groq.com/openai/v1/chat/completions",
                {"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
                {"model": model, "messages": [{"role": "user", "content": prompt}]})
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise SystemExit(f"Respuesta inesperada de Groq: {json.dumps(data)[:400]}")


PROVIDERS = {"gemini": gemini, "groq": groq}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("idea")
    ap.add_argument("--provider", choices=PROVIDERS, default="gemini")
    ap.add_argument("--duracion", type=int, default=30, help="segundos (default 30)")
    ap.add_argument("--salida", help="guardar el resultado en este archivo")
    a = ap.parse_args()

    env = load_env()
    voz = ""
    vp = os.path.join(HERE, "voice.md")
    if os.path.exists(vp):
        voz = "Escribe con esta voz y estilo:\n" + open(vp, encoding="utf-8").read() + "\n"
    prompt = PROMPT.format(voz=voz, idea=a.idea, dur=a.duracion, palabras=int(a.duracion * 2.5))

    out = PROVIDERS[a.provider](prompt, env)
    print(out)
    if a.salida:
        with open(a.salida, "w", encoding="utf-8") as f:
            f.write(out)
        print(f"\n✅ Guardado en {a.salida}", file=sys.stderr)


if __name__ == "__main__":
    main()
