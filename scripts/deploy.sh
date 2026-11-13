#!/usr/bin/env bash
# Despliega los microservicios en orden con Serverless Framework.
#
#   bash scripts/deploy.sh                 # todos: infra, employees, identity, recruitment, time_leave
#   bash scripts/deploy.sh identity        # solo los que indiques, en ese orden
#
# Lee la configuración del .env de la RAÍZ del repo (Serverless solo buscaría uno por servicio).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$ROOT/.env" ]]; then
  echo "Falta $ROOT/.env: cópialo desde .env.example y complétalo." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source <(sed 's/\r$//' "$ROOT/.env")
set +a

# Si estas variables quedaron vacías en el .env, se quitan para que se usen las
# credenciales del perfil de instancia (LabInstanceProfile) de la VM.
for var in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do
  if [[ -z "${!var:-}" ]]; then unset "$var"; fi
done

for var in LAB_ROLE_ARN JWT_SECRET PLATFORM_ADMIN_KEY DB_USER DB_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    echo "Falta $var en el .env" >&2
    exit 1
  fi
done

STAGE="${STAGE:-dev}"
SERVICES=("$@")
if [[ ${#SERVICES[@]} -eq 0 ]]; then
  SERVICES=(infra employees identity recruitment time_leave)
fi

for svc in "${SERVICES[@]}"; do
  echo
  echo "════════ $svc ($STAGE) ════════"
  cd "$ROOT/services/$svc"
  npm install --no-audit --no-fund --loglevel=error
  npx serverless deploy --stage "$STAGE"
done

echo
echo "Listo. Endpoints de cada servicio:"
for svc in "${SERVICES[@]}"; do
  [[ "$svc" == "infra" ]] && continue
  stack="hcm-${svc//_/-}-$STAGE"
  url=$(aws cloudformation describe-stacks --stack-name "$stack" \
        --query "Stacks[0].Outputs[?OutputKey=='ServiceEndpoint'].OutputValue" --output text 2>/dev/null || true)
  printf '  %-12s %s\n' "$svc" "${url:-(sin endpoint)}"
done
