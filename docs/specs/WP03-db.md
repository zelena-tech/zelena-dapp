# WP03 · Capa DB lista para Turso/Postgres

CONTEXTO — SQLite local no persiste en Vercel (fork F2 del wargame). La capa ya está aislada en `lib/db.ts` (driver dual previsto). Instrucciones base en `docs/deploy.md`.

PROBLEMA — Sin swap de DB no hay deploy serverless persistente; sin deploy no hay cohorte.

RESULTADO ESPERADO — La app corre idéntica contra SQLite local (dev) y libSQL/Turso (prod), seleccionado por env var. Seed reproducible en ambos.

ALCANCE
- Completar el driver libSQL en `lib/db.ts` (cliente `@libsql/client`), seleccionado por `DATABASE_URL`/`TURSO_*`.
- Adaptar `schema.sql` y `seed.ts` a diferencias de dialecto si las hay (mínimas en libSQL).
- Tests: suite completa corre contra ambos drivers (local file para libSQL en CI).
- Documentar en `docs/deploy.md` las env vars exactas.

NO-ALCANCE — El deploy en sí (WP05, needs_human). Postgres puro (solo si Turso falla). Migraciones de datos de producción (no hay producción aún).

CRITERIOS DE ACEPTACIÓN
- [ ] `npm test` verde con driver SQLite y con driver libSQL (archivo local).
- [ ] Flujo completo en localhost funciona con `DATABASE_URL` apuntando a libSQL local.
- [ ] Rate-limit anotado: si se despliega serverless, mover a storage compartido (nota para WP05).

OWNER — Dev 2 · AGENTE: driver + tests · HUMANO: crea cuenta Turso y provee credenciales (fuera de este WP).
TAMAÑO — M · Estimado: medio día.
