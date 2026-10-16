---
name: reels-en-lote
description: Produce varios Reels de una vez a partir de varios guiones o de una planilla (CSV/JSON) - genera voz y timeline por guion, hace el control visual de cada uno y renderiza en lote. Usar cuando pidan preparar una semana de contenido o variantes del mismo Reel.
---

# Reels en lote

Para preparar varios Reels juntos (una semana, o variantes A/B de un gancho).

## Entrada

Una carpeta con un guion por archivo (`guion/lote/dia-01.txt`, `dia-02.txt`…) en el formato de `reels-guionista`, o un CSV con columnas `id, guion, caption` que se convierte en esos archivos.

## Proceso

1. **Cada guion pasa por `reels-guionista`** (ganchos, tiempos, caption, control ≥ 90). En lote no se saltean controles: un guion flojo no mejora por ir acompañado.
2. Voz por guion:
   ```bash
   for f in lote/*.txt; do python tts.py "$f" --estilo cinematografico; done
   for d in ../video/public/voz/*/; do python voz_cine.py "$d"; done
   ```
3. **Control visual de cada uno** (regla de `reels-video`): 3 cuadros por Reel, en una sola revisión.
4. Render:
   ```bash
   cd video
   for t in public/voz/*/timeline.json; do
     n=$(basename "$(dirname "$t")")
     npx remotion render ReelFromTimeline "out/$n.mp4" --props="$t"
   done
   ```
5. Entregar una tabla: id, gancho, largo, puntaje, archivo. **Publicar uno por uno**, en el horario del plan, con aprobación del usuario.

## Variantes A/B

Mismo cuerpo, dos ganchos de fórmulas distintas. Publicarlas en días distintos y a la misma hora; comparar a las 48 h por múltiplo sobre la mediana y tasa de salto, no por vistas crudas.
