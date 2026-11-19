#!/usr/bin/env sh
# Arranque del paquete standalone en Azure App Service (Linux, NODE:22-lts).
# Va en la raíz del paquete (/home/site/wwwroot/start.sh); el comando de inicio
# de App Service es `sh /home/site/wwwroot/start.sh`. El paquete lo arma
# .github/workflows/paquete-azure.yml.
cd "$(dirname "$0")" || exit 1

# node:sqlite viene sin flag desde Node 22.13; con un runtime menor se activa el
# flag experimental (respaldo si better-sqlite3 no carga).
node -e "require('node:sqlite')" >/dev/null 2>&1 || export NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-sqlite"

# Mismo control que start-azure.sh: un paquete incompleto no arranca.
# Solo para una emergencia consciente: ZELENA_OMITIR_VERIFICACION=1 en App Settings.
if [ "${ZELENA_OMITIR_VERIFICACION:-}" != "1" ]; then
  node apps/web/scripts/verificar-paquete.mjs apps/web || {
    echo "[start] Paquete incompleto: no se arranca. Corrige el paquete (ver arriba)." >&2
    exit 1
  }
fi

# App Service pone PORT; HOSTNAME trae el nombre del contenedor y Next se ataría a él.
export HOSTNAME=0.0.0.0
exec node apps/web/server.js
