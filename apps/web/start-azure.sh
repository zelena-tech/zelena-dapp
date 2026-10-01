#!/usr/bin/env bash
# Arranque en Azure App Service (Linux, NODE:22-lts) con el paquete precompilado (.next + node_modules).
# Se invoca Next con node directamente: los atajos de node_modules/.bin pueden perder el bit de ejecucion
# al extraer un zip generado en Windows. node:sqlite viene sin flag desde Node 22.13; si el runtime fuera
# menor, se activa el flag experimental.
node -e "require('node:sqlite')" >/dev/null 2>&1 || export NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-sqlite"

# Verificacion del paquete ANTES de arrancar (fusion v1, 2026-09-30): node_modules de la misma build
# (next >= 14.2.35 y next-auth; no el que Oryx construyo para 14.2.15), CLA.md con el hash que firman
# las altas, docs/whitepaper.md y src/lib/schema.sql. Sin esto un paquete incompleto arranca y falla
# despues, o firma el texto de reserva del CLA. Ver docs/DESPLIEGUE-V1.md, "Paquete del despliegue".
# Solo para una emergencia consciente: ZELENA_OMITIR_VERIFICACION=1 en App Settings.
if [ "${ZELENA_OMITIR_VERIFICACION:-}" != "1" ]; then
  if [ -f scripts/verificar-paquete.mjs ]; then
    node scripts/verificar-paquete.mjs . || {
      echo "[start-azure] Paquete incompleto: no se arranca. Corrige el paquete (ver arriba)." >&2
      exit 1
    }
  else
    echo "[start-azure] AVISO: el paquete no trae scripts/verificar-paquete.mjs; se arranca sin verificar." >&2
  fi
fi

exec node node_modules/next/dist/bin/next start
