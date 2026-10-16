# Instalación paso a paso

Tiempo estimado: 30–60 minutos la primera vez. Hazlo en orden.

## 1. Descargar el kit

```bash
git clone https://github.com/cristianrodas-dev/reels-con-ia-kit.git
cd reels-con-ia-kit
npm install
cd video && npm install && cd ..
```

## 2. Cuenta de Instagram profesional

En la app de Instagram: *Configuración › Tipo de cuenta y herramientas › Cambiar a cuenta profesional* (creador o empresa).

## 3. App de Meta y token

1. Entra a [developers.facebook.com](https://developers.facebook.com) › **Crear app** › caso de uso **"Administrar mensajes y contenido en Instagram"**.
2. En **API con inicio de sesión de Instagram**, agrega tu cuenta y genera un **token**.
3. Copia el **ID de usuario de Instagram**, el **token**, el **App ID** y el **App secret** a tu `.env` (nunca a otro lado).
4. Prueba la conexión:
   ```bash
   npm test
   ```
5. El token dura ~60 días. Renuévalo con `npm run refresh` (actualiza el `.env` solo).

## 4. Supabase (para publicar)

La API de Instagram necesita el video en una URL pública.

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. *Storage › New bucket* › nombre `reels`, **público**, límite 100 MB, tipos `video/mp4, image/png, image/jpeg`.
3. Agrega una política de **solo lectura (SELECT)** para el bucket.
4. Copia la URL del proyecto y la **clave secreta** (*Settings › API keys*) a tu `.env`.

## 5. Conectar el servidor a Claude

En Claude de escritorio: *Configuración › Desarrollador › Editar configuración* y agrega (ajusta la ruta):

```json
{
  "mcpServers": {
    "instagram": {
      "command": "npx",
      "args": ["tsx", "RUTA/A/reels-con-ia-kit/mcp/instagram-server.ts"]
    }
  }
}
```

No pongas el token en este archivo: el servidor lo lee del `.env`. Reinicia Claude.

Herramientas que aparecen: `publish_reel`, `upload_video`, `delete_video`, `get_media_insights`, `list_recent_media`, `get_account_insights`, `analyze_viral_patterns`.

## 6. Skills

Copia cada carpeta de `skills/` a tus skills de Claude (o súbelas desde *Configuración › Capacidades › Skills*). Empieza por `reels-guionista`.

## 7. Voz (opcional)

```bash
cd guion
python tts.py --voces                      # ver voces disponibles
python tts.py mi-guion.txt --estilo cinematografico
python voz_cine.py ../video/public/voz/mi-guion
```

Motores: `elevenlabs` (pago, mejor calidad), `kokoro` (gratis, local), `edge`, `azure`. Para tu propia voz grabada: `align.py`.

## 8. Renderizar

```bash
cd video
npx remotion studio                                            # vista previa
npx remotion render ReelFromTimeline out/reel.mp4 --props=public/voz/mi-guion/timeline.json
```

Para cambiar la marca de arriba, agrega `"brandName": "TU MARCA"` al `timeline.json`.

## Problemas comunes

| Síntoma | Causa |
|---|---|
| `ERROR: Faltan IG_USER_ID o IG_ACCESS_TOKEN` | El `.env` no está en la carpeta raíz o tiene otro nombre. |
| `(#10) Application does not have permission` | Falta el permiso de publicación en la app de Meta. |
| El video sube pero no publica | El bucket no es público o el MP4 no es H.264/AAC. |
| Textos corridos a un costado | Alguien cambió la zona segura: debe ser simétrica (`left: 120, right: 960`). |
