#!/usr/bin/env bash
# Arranque en Azure App Service (Linux, NODE:22-lts) con el paquete precompilado (.next + node_modules).
# Se invoca Next con node directamente: los atajos de node_modules/.bin pueden perder el bit de ejecucion
# al extraer un zip generado en Windows. node:sqlite viene sin flag desde Node 22.13; si el runtime fuera
# menor, se activa el flag experimental.
node -e "require('node:sqlite')" >/dev/null 2>&1 || export NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-sqlite"
exec node node_modules/next/dist/bin/next start
