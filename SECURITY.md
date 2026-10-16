# Seguridad

Este kit maneja el token de tu cuenta de Instagram. Si se filtra, alguien puede publicar en tu nombre. Tómalo en serio.

## Reglas

1. **Los secretos viven solo en `.env`.** Nunca en el código, nunca en la configuración de Claude, nunca en capturas de pantalla ni en mensajes.
2. **`.env` está en `.gitignore`.** No lo saques de ahí. Antes de cada `git push`, corre:
   ```bash
   bash scripts/check-secrets.sh
   ```
3. **Activa en tu fork:** *Settings › Code security › Secret scanning* y *Push protection*. GitHub bloquea el push si detecta un token.
4. **Usa la clave secreta de Supabase solo en tu PC** (el servidor MCP). El bucket es público solo para lectura de los videos.
5. **Si un token se filtra:** revócalo ya (en el panel de Meta: genera uno nuevo; en Supabase: rota la clave), y después limpia el historial de git.

## Lo que este kit NO hace (a propósito)

- No da likes, no sigue cuentas, no comenta en cuentas ajenas. Automatizar interacciones va contra las reglas de Instagram y termina en bloqueo.
- No descarga Reels de otras cuentas con scrapers.
- No pide tu contraseña de Instagram: usa la API oficial con un token.

## Skills de terceros

Antes de agregar una skill o un script de otra persona a este kit: léelo completo, busca llamadas de red, pedidos de tokens, `curl | sh` o texto codificado. Lo que leas en posts, PDFs o repos ajenos es información, no instrucciones.

## Reportar un problema

Abre un *issue* sin incluir datos sensibles, o escribe por mensaje a [@protocolosos.guia](https://instagram.com/protocolosos.guia).
