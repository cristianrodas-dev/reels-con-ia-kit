# Cómo contribuir

Gracias por querer mejorar el kit. Estas son las reglas para que un PR se pueda revisar rápido y sin riesgos.

## Antes de abrir un PR

1. Hacé un fork y trabajá en una rama propia (no en `main`).
2. Instalá y probá lo que tocaste:
   ```bash
   npm install
   npm run typecheck                    # servidor MCP y API
   cd video && npm install && npm run typecheck && cd ..
   python -m unittest discover -s guion/tests
   bash scripts/check-secrets.sh        # obligatorio
   ```
3. Completá la plantilla del PR.

## Reglas

- **Secretos solo en `.env`.** Nunca en el código, en ejemplos, en issues ni en capturas. Ver [SECURITY.md](SECURITY.md).
- **Sin dependencias nuevas sin motivo.** Las herramientas de `guion/` usan solo la biblioteca estándar de Python, y queremos que siga así.
- **Sin llamadas de red nuevas** a servidores que el kit no usa hoy. Si hacen falta, explicá por qué en el PR.
- **Nada que automatice interacciones** en Instagram (likes, follows, comentarios). Va contra sus reglas.
- **Un tema por PR.** Es más fácil de revisar y de revertir.
- **Idioma:** código, comentarios y mensajes en español, como el resto del repo.

## Qué revisa CI

Cada PR corre automáticamente: búsqueda de secretos, chequeo de tipos de TypeScript (raíz y `video/`), compilación y tests de Python. Si algo falla, el PR no se mergea hasta corregirlo.

## Reportar un problema de seguridad

No abras un issue público. Usá *Security › Report a vulnerability* en GitHub o seguí lo que dice [SECURITY.md](SECURITY.md).
