#!/usr/bin/env bash
# Arranque en Azure App Service (Linux, NODE:22-lts). Sin driver nativo, lib/db.ts usa node:sqlite,
# que viene sin flag desde Node 22.13; si el runtime fuera menor, activamos el flag experimental.
node -e "require('node:sqlite')" >/dev/null 2>&1 || export NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-sqlite"
exec npm run start
