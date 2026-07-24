# QUEUE — Cola dinámica de trabajo

Protocolo: tomar el primer `ready` cuyas dependencias estén `done`. Estados: `ready` · `in_progress` · `done` · `blocked` (técnico, con nota) · `needs_human` (falta algo de John) · `blocked_external` (gate legal/comercial).

Los ítems `FBxx` (feedback de John, ver FEEDBACK.md) tienen prioridad sobre los WP.

| ID | Work package | Estado | Depende de | Rama | Nota |
|---|---|---|---|---|---|
| WP00 | Limpieza + baseline verde | done | — | wp/00-limpieza | ✅ 4524dff · tag v0.1-genesis · develop |
| WP01 | Verificación criptográfica de firma | done | WP00 | wp/01-firma | ✅ ed25519 + domain separator; H1/H3 cerrados |
| WP02 | Genoma v1 (config → DB versionada) | done | WP00 | wp/02-genoma | ✅ genome_versions + getActiveGenome; consumidores migrados |
| WP03 | Capa DB lista para Turso/Postgres | ready | WP00 | wp/03-db | Implementar driver + tests locales; credenciales Turso = John |
| WP04 | Identidad Privy | needs_human | WP01 | wp/04-privy | Requiere PRIVY_APP_ID/SECRET de John. Scaffolding detrás de flag sí es ejecutable |
| WP05 | Deploy público + worker | needs_human | WP01, WP03 | — | Vercel/VPS login = John |
| WP06 | Repo público + CLA-bot | needs_human | WP00 | — | Org GitHub = John |
| WP07 | Motor de épocas (fitness) | done | WP02 | wp/07-fitness | ✅ fitness puro + epoch_fitness + cierre/firma en admin |
| WP08 | Mutación por época (admin) | ready | WP07 | wp/08-mutacion | |
| WP09 | Reglas conductuales UI | done | WP00 | wp/09-ui-conductual | ✅ bloque "Tu progreso" + test anti-confiscación + copys |
| WP10 | Nómina Modo A+ | blocked_external | WP05 | wp/10-nomina | Gate: consulta legal/tributaria. UI + schema sí ejecutables detrás de flag |
| WP11 | Simulador ABM | ready | WP02 | wp/11-sim | Ejecutable esta noche tras WP02 |
| WP12 | Auditoría funciones latentes | ready | WP09 | wp/12-auditoria | Plantilla + página gobernanza |

## Orden sugerido para el primer loop nocturno

WP00 → WP01 → WP02 → WP09 → WP07 → WP11 → WP03 → WP08 → WP12 → scaffolding de WP04/WP10 detrás de flags → NIGHT-REPORT.md

## Registro de cierres

(El loop añade aquí una línea por WP cerrado: fecha · WP · commit · tests)

- 2026-07-24 · WP00 · baseline `4524dff` (main, tag v0.1-genesis, rama develop) · npm install OK, test 20/20, build OK
- 2026-07-24 · WP01 · verificación ed25519 + domain separator (wp/01-firma) · test 31/31, build OK
- 2026-07-24 · WP02 · genoma versionado en DB + migración de consumidores (wp/02-genoma) · test 37/37, build OK
- 2026-07-24 · WP09 · progreso propio + test anti-confiscación + copys de entrega (wp/09-ui-conductual) · test 40/40, build OK
- 2026-07-24 · WP07 · motor de fitness puro + persistencia + cierre/firma en admin (wp/07-fitness) · test 52/52, build OK
