## Qué cambia

<!-- Una o dos frases: qué hace este PR y por qué. -->

## Cómo lo probaste

<!-- Comandos que corriste, o "no aplica". -->

## Checklist

- [ ] Corrí `bash scripts/check-secrets.sh` y no aparece ningún secreto.
- [ ] No subo `.env`, tokens, claves ni capturas con datos de cuentas.
- [ ] No agrego dependencias nuevas, o explico arriba por qué hacen falta.
- [ ] El código no manda datos a servidores nuevos (solo Instagram, Supabase y los proveedores de voz o LLM que ya usa el kit).
- [ ] Si cambié algo en `guion/`, corrí `python -m unittest discover -s guion/tests`.
- [ ] Si cambié TypeScript, corrí `npm run typecheck` (y en `video/` si toqué la plantilla).
