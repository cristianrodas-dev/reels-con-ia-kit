#!/usr/bin/env bash
# Revisa que no se esté por subir ningún secreto. Correr antes de cada push.
#   bash scripts/check-secrets.sh
set -u
cd "$(git rev-parse --show-toplevel)"
fail=0

# 1) Archivos que nunca deben estar en git
for f in $(git ls-files); do
  case "$f" in
    .env|.env.*) [ "$f" != ".env.example" ] && { echo "✖ $f está en git (debe estar ignorado)"; fail=1; } ;;
  esac
done

# 2) Patrones de tokens y claves conocidos (en archivos versionados y en el área de preparación)
PATTERNS='IGAA[A-Za-z0-9_-]{20,}|EAA[A-Za-z0-9]{30,}|sb_secret_[A-Za-z0-9_-]{10,}|eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|sk_[a-f0-9]{32,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
hits=$(git grep -I -n -E "$PATTERNS" -- . ':!scripts/check-secrets.sh' 2>/dev/null; git diff --cached -U0 | grep -E "^\+" | grep -E "$PATTERNS")
if [ -n "$hits" ]; then echo "✖ Posibles secretos:"; echo "$hits" | cut -c1-120; fail=1; fi

# 3) Valores reales en .env.example
if git ls-files --error-unmatch .env.example >/dev/null 2>&1; then
  if grep -E "^[A-Z_]+=(IGAA|EAA|sb_secret_|eyJ)" .env.example >/dev/null; then echo "✖ .env.example tiene un valor real"; fail=1; fi
fi

# 4) gitleaks, si está instalado
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --no-banner --redact -v || fail=1
fi

[ $fail -eq 0 ] && echo "✅ Sin secretos a la vista." || { echo "⛔ Corrige lo de arriba antes de hacer push."; exit 1; }
