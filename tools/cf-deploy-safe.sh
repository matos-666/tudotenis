#!/usr/bin/env bash
# Deploy seguro para a conta inbet. Aborta se a sessão wrangler não for
# a conta certa — blindagem contra deploy no webpronos.
set -euo pipefail
EXPECTED_ACCOUNT="ccf33caf793e2b3f1fe68bd28ee3d503"

echo "── 1. Verificar conta autenticada ──"
WHO=$(npx wrangler whoami 2>&1 || true)
if ! echo "$WHO" | grep -q "$EXPECTED_ACCOUNT"; then
  echo "❌ ABORTADO: sessão wrangler NÃO está na conta inbet ($EXPECTED_ACCOUNT)."
  echo "   Corre 'npx wrangler login' e escolhe matos@inbet.io primeiro."
  echo "$WHO" | grep -iE "account|email" || true
  exit 1
fi
echo "✓ conta inbet confirmada"

echo "── 2. Build + deploy ──"
npm run cf:deploy

echo "── 3. Segredos de runtime (valores do .env.local, sem imprimir) ──"
for NAME in SUPABASE_SERVICE_ROLE_KEY CRON_SECRET ADMIN_PASSWORD ADMIN_COOKIE_SECRET REVALIDATE_SECRET ODDS_API_KEY; do
  VAL=$(grep -E "^${NAME}=" .env.local | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')
  if [ -z "$VAL" ]; then echo "  ⚠ $NAME em falta no .env.local — salta"; continue; fi
  printf '%s' "$VAL" | npx wrangler secret put "$NAME" >/dev/null 2>&1 && echo "  ✓ $NAME" || echo "  ❌ $NAME falhou"
done

echo "── 4. Feito. Testa o URL .workers.dev acima. ──"
