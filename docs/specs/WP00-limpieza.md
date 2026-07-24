# WP00 · Limpieza + baseline verde

CONTEXTO — El sandbox de construcción dejó duplicados que no pudo borrar (ver `docs/decisions-pending.md`). Antes de cualquier trabajo, el repo debe quedar limpio con la suite verde: es el baseline contra el que se mide todo lo demás.

PROBLEMA — Archivos duplicados/basura confunden a humanos y agentes, y un baseline no verificado hace imposible saber si un WP rompió algo.

RESULTADO ESPERADO — Repo limpio, suite 20/20 verde, build verde, tag `v0.1-genesis` creado, rama `develop` creada desde ese estado.

ALCANCE
- Eliminar los duplicados listados en `docs/decisions-pending.md` (app viejo, `middleware.ts` duplicado, `node_modules` interno de `apps/web/src/`).
- `npm install && npm test && npm run build` verdes.
- Crear rama `develop`; tag `v0.1-genesis` en el commit limpio.

NO-ALCANCE — Ningún cambio funcional. Ningún refactor. Ninguna dependencia nueva.

CRITERIOS DE ACEPTACIÓN
- [ ] `git status` limpio tras la limpieza; ningún archivo listado en decisions-pending.md sigue presente.
- [ ] `npm test` 20/20 y `npm run build` sin errores.
- [ ] Tag `v0.1-genesis` y rama `develop` existen.

OWNER — Dev 1 · AGENTE: ejecuta todo · HUMANO: revisa el diff de borrado antes de merge.
TAMAÑO — S · Estimado: 1-2 h.
