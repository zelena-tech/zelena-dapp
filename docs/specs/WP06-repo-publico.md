# WP06 · Repo público + CLA-bot + branch protection (needs_human)

CONTEXTO — Plan Maestro §3.3 y §6.2: la PI se blinda en la puerta del repo. Los archivos de gobernanza ya existen (CLA.md, CONTRIBUTING.md, LICENSE, CODEOWNERS, SECURITY.md). K6 de M1: ≥3 PRs externos merged bajo CLA-check.

RESULTADO ESPERADO — Repo público en la org GitHub de la SAS donde ningún PR externo puede mergear sin CLA firmado, y las rutas críticas exigen revisión del owner.

ALCANCE
- Crear org GitHub (titularidad SAS) y publicar el repo (John).
- CLA-bot (cla-assistant o GitHub Action equivalente) apuntando al CLA.md del repo; bloquea merge sin firma.
- Branch protection en `main` y `develop`: PR + CI verde + review obligatorio.
- CODEOWNERS: rutas críticas (`packages/contracts/`, `apps/web/src/lib/genome.ts`, `lib/fitness.ts`, `lib/crypto.ts`, `app/api/`) requieren aprobación del founder/Dev 1.
- CI mínima: `npm test` + build en cada PR (GitHub Actions).

NO-ALCANCE — Bug bounty (M2, con treasury). Licencia más permisiva (decisión de gobernanza posterior, Plan Maestro 3.2).

CRITERIOS DE ACEPTACIÓN
- [ ] PR de prueba desde cuenta externa sin CLA: bloqueado. Con CLA firmado: mergeable tras CI + review.
- [ ] Push directo a main/develop: imposible.
- [ ] CI corre y reporta en <5 min.

OWNER — John (org, permisos) + Dev 2 (bot y CI) · TAMAÑO — S · Estimado: 2-3 h.
