---
name: reels-video
description: Produce el MP4 de un Reel 1080x1920 con la plantilla de Remotion del kit (apertura cinematográfica, títulos y subtítulos centrados, voz por beat) y hace el control visual antes y después del render. Usar cuando haya un timeline.json listo o pidan renderizar, editar o revisar un Reel.
---

# Video del Reel (Remotion)

Plantilla en `video/`. Una sola composición, `ReelFromTimeline`, cuyas props **son** el `timeline.json` que genera `guion/beats.py --remotion` o `guion/tts.py`.

## Props útiles del timeline

| Prop | Default | Qué hace |
|---|---|---|
| `cinematic` | `true` | Tormenta, chispas, glitch, grano, sonido. |
| `introFrames` | `60` | Duración de la apertura antes del primer título (2 s). |
| `stormImage` | `""` | Vacío = tormenta generada por código. Una imagen propia **solo si tienes derechos de uso**. |
| `brandName` | `"PROTOCOLO SOS"` | Nombre de marca arriba. |
| `voiceoverSrc` | — | Toma de voz completa (grabada y alineada con `align.py`). Si no, usa el `audio` de cada beat. |
| `musicSrc` | — | Música de fondo (volumen 0,12). Solo música con licencia. |

## REGLA FIJA: todo centrado en x = 540

Títulos, subtítulos, barra de progreso y marca comparten el eje central. Márgenes **simétricos**:

```tsx
const SAFE = { top: 230, bottom: 1440, right: 960, left: 120 };
```

Nunca un margen más grande de un lado "para esquivar los botones": corre todo el texto y se nota contra la marca centrada. Los botones de Instagram ocupan x > ~980 en la mitad inferior; con 120 px por lado quedan libres.

## REGLA FIJA: control visual antes de entregar

1. Renderizar 3 cuadros (gancho, medio, cierre):
   ```bash
   npx remotion still ReelFromTimeline qa-gancho.png --props=<timeline.json> --frame=<intro+15> --scale=0.5
   npx remotion still ReelFromTimeline qa-medio.png  --props=<timeline.json> --frame=<mitad> --scale=0.5
   npx remotion still ReelFromTimeline qa-cta.png    --props=<timeline.json> --frame=<cta+15> --scale=0.5
   ```
2. Verificar: todo sobre el mismo eje central; nada en x > 980 ni debajo de y = 1440; ninguna palabra cortada.
3. Si algo falla, corregir y repetir. Recién ahí renderizar el MP4:
   ```bash
   npx remotion render ReelFromTimeline out/reel.mp4 --props=<timeline.json>
   ```
4. Extraer 2 cuadros del MP4 con ffmpeg y mirarlos de nuevo. Un video publicado no se puede reemplazar.

## Voz

```bash
cd guion
python tts.py guion.txt --estilo cinematografico     # voz IA por beat + timeline.json
python voz_cine.py ../video/public/voz/<reel>        # EQ, compresión, eco corto, -14 LUFS
```

Voz propia: grabar una toma, `python align.py guion.txt toma.wav` y usar `voiceoverSrc`.

## Requisitos de Instagram

H.264 + AAC, 9:16, 1080×1920, 30 fps. Etiqueta de IA al publicar si la voz o la imagen son generadas y realistas.
