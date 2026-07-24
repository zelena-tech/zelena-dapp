# WP05 · Deploy público + worker de anclaje (needs_human)

CONTEXTO — La dapp corre solo en localhost. Doc 15 día 3: URL pública para la cohorte. Instrucciones base: `docs/deploy.md` + informe de ejecución §4.

RESULTADO ESPERADO — URL pública estable con flujo completo, worker de anclaje corriendo, secretos bien gestionados.

ALCANCE
- Vercel + Turso (plan $0) o VPS (~$5/mes) — decisión de John según el resultado de WP03.
- Env vars: `SESSION_SECRET`, `FOUNDER_WALLET`, `DATABASE_URL`, (si WP04: `PRIVY_*`). Producción NO arranca sin secretos (ya implementado).
- Rate-limiting a storage compartido si serverless (hallazgo del security review).
- `anchor-worker.mjs --watch` corriendo (máquina de John o el VPS) contra testnet.
- Smoke test post-deploy: invitación → CLA → perfil en la URL pública.

NO-ALCANCE — Dominio final/DNS (puede ser *.vercel.app en v1). Mainnet. CI/CD completo (siguiente iteración).

CRITERIOS DE ACEPTACIÓN
- [ ] Flujo completo end-to-end en URL pública, con datos persistentes tras redeploy.
- [ ] Hash de un CLA real anclado y verificable en el explorador de testnet.
- [ ] Ningún secreto en el repo; rate-limit funcional en el entorno elegido.

OWNER — Dev 2 + John (cuentas) · TAMAÑO — M · Estimado: medio día con credenciales listas.
