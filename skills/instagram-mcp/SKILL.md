---
name: instagram-mcp
description: Usa el servidor MCP de Instagram del kit para publicar Reels, leer métricas de posts y de la cuenta, y detectar qué patrones funcionan. Usar cuando pidan publicar, ver estadísticas, auditar la cuenta o conectar Instagram a la IA.
---

# Servidor MCP de Instagram

Código en `mcp/`. Usa la **API de Instagram con inicio de sesión de Instagram** (`graph.instagram.com`). Instalación: `docs/instalacion.md`.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `publish_reel` | Publica un Reel desde una URL pública o una ruta local (lo sube a Supabase, publica y borra la copia). |
| `upload_video` | Sube un MP4, PNG o JPG al bucket y devuelve la URL pública. |
| `delete_video` | Borra un archivo del bucket. |
| `list_recent_media` | Últimos posts con likes, comentarios, link y caption. |
| `get_media_insights` | Métricas de un post: vistas, alcance, likes, comentarios, compartidos, guardados, tiempo medio de visualización, tasa de salto. |
| `get_account_insights` | Métricas de la cuenta en un período. |
| `analyze_viral_patterns` | Rankea posts por puntaje (vistas + compartidos×20 + guardados×15 + comentarios×5 + likes×2) y sugiere patrones. |

## Reglas

- **Publicar requiere un "sí" explícito del usuario**, cada vez.
- Antes de publicar: el MP4 pasó el control visual de `reels-video` y el caption pasó `caption.py`.
- Los secretos se leen solo del `.env`. No pedir el token en el chat, no escribirlo en código ni en la configuración del asistente.
- La API **no puede**: agregar stickers a historias, publicar Notas, editar la biografía, ni leer cuentas ajenas. No intentarlo por otras vías.
- No automatizar likes, follows ni comentarios.

## Límites conocidos de la API

- Reels: `follows` y `profile_visits` no existen como métrica por post; sí en la cuenta.
- Las métricas de historias solo se leen mientras la historia está activa (24 h).
- El token dura ~60 días: `npm run refresh`.

## Recarga en caliente

El servidor recarga `mcp/tools.ts` cuando cambia el archivo, sin reiniciar. Agregar una herramienta nueva sí requiere reiniciar el asistente.
