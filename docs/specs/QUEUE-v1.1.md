# QUEUE-v1.1 — inserción pendiente para QUEUE.md

QUEUE.md estaba bloqueado por otra sesión al momento de encolar (2026-09-02). Este archivo contiene EXACTAMENTE lo que hay que insertar: las filas van después de la fila `WP19`; la sección va antes de `## Owners humanos del release v1`; las filas de owners van antes de `| Gate de calidad de todos |`.

## Filas para la tabla principal

| ID | Work package | Estado | Depende de | Rama | Nota |
|---|---|---|---|---|---|
| **WP25** | **Ciclo de vida completo: `Closed` + puente Ágora↔equipo + motivo de aplicaciones** | v1.1 | WP14 | wp/25-ciclo | Primera ola de v1.1 "Comunidad". Secuencial con WP23 (`state-machine.ts`). Flag `LIFECYCLE_V2_ENABLED` |
| **WP26** | **Ritos: calendario + check-in QR + participación del fitness** | v1.1 | WP14, WP07 | wp/26-ritos | Cierra el hueco `participation` de `gatherEpochData`. `RITES_SECRET` = John. Flag `RITES_ENABLED` |
| **WP27** | **Misiones de comunidad (biblioteca interna, paga en reputación)** | v1.1 | WP26, WP08, WP14, WP17 | wp/27-misiones | Reusa `assignments` (`kind='mision'`); gen `RITOS_BUDGET` = genoma v2. No arranca con WP14/WP17 `in_progress`. Flag `MISSIONS_ENABLED` |
| **WP28** | **Onboarding con eje + primera misión; perfil con siguiente paso y mis aplicaciones** | v1.1 | WP25, WP27 | wp/28-perfil | No toca el orden firma→invitación de WP01 |
| **WP29** | **Disputas: rama `Disputed`, caso del guardián, resolución aditiva del hito** | v1.1 | WP25, WP26 | wp/29-disputas | Secuencial con WP23/WP25 (`state-machine.ts`) y WP26 (`epochs.ts`). Flag `DISPUTES_ENABLED` |
| **WP30** | **Integridad del anclaje: merkle spec, claves sin colisión, CLA v2, multisig** | v1.1 | WP01 | wp/30-anclaje | Multisig = subtarea `needs_human` (John). Nada retroactivo sobre lo ya anclado. Secuencial con WP26 (worker) |

## Release v1.1 "Comunidad" — propuesto 2026-09-02, NO entra en v1

Seis WPs (WP25–WP30) nacidos del análisis Edge City + revisión del ciclo de vida + revisión on-chain (lienzo "Zelena DAO Experiencia"). Estado `v1.1`: el loop no los toma hasta que John cambie el estado a `ready`, para no romper el núcleo congelado de v1 ni chocar con WP14/WP17 (`assignments.ts`) y WP23 (`state-machine.ts`) mientras siguen abiertos. Todos son aditivos (tablas nuevas o columnas nullable vía `COLUMNAS_NUEVAS`), detrás de flag, y sin `DELETE`/`UPDATE` destructivo.

Orden sugerido (por dependencias y archivos compartidos): WP25 (tras WP23) → WP26 → WP27 (tras WP14/WP17) → WP28 → WP29 → WP30. WP26 y WP30 comparten el worker; WP25/WP29 comparten `state-machine.ts` con WP23: nunca en paralelo entre sí.

Correcciones de registro que estos specs asumen: `assignments.published_as_project_id` ya existe (el puente no necesita columna nueva); `mechanism` vive en `latent_audits`, no en `reputation_events`; `projects.state` no tiene CHECK, así que añadir estados no exige reconstruir la tabla.

## Filas para la tabla de owners

| WP | Owner humano | Apoyo |
|---|---|---|
| WP25 Ciclo completo | Fausto | David (UI), Vale (tests) |
| WP26 Ritos | Fausto | David (UI), Vale (define ritos), John (RITES_SECRET) |
| WP27 Misiones | Fausto | David (UI), Vale (curadora) |
| WP28 Onboarding + perfil | David | Fausto (regla pura), Vale (copys) |
| WP29 Disputas | Fausto | Vale (guardiana seed), John (guardianes), Juan (pagos parciales) |
| WP30 Integridad del anclaje | Fausto | John (multisig), Vale (lectora externa de la spec) |
