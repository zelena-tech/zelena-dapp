# Deudas y decisiones pendientes — Dapp v0.1

Anotadas para el founder. Ninguna bloquea el Milestone 1; son elecciones a ratificar o
trabajo pospuesto a fases posteriores.

## Forks tomados (confirmar)

1. **Sin contratos Soroban (Fork F1).** El entorno no tiene Rust/stellar-cli. El anclaje se
   hace con `manageData` (suficiente para M1). `packages/contracts` (token ZWORK, treasury)
   queda para M2. Deuda: cuando se requiera lectura on-chain por otros contratos, desplegar
   `anchor(hash)` en Soroban.
2. **SQLite en vez de Postgres (Fork F2).** Excelente para la cohorte Génesis local. En
   Vercel NO persiste: hay que migrar a Postgres/Turso antes de un deploy multiusuario real.
   La capa está aislada en `lib/db.ts`. Ver `deploy.md`.
3. **Anclaje como cola local (por red del sandbox).** El worker corre en la máquina del
   usuario. Si se despliega, mover el worker a un cron/VM con acceso a Stellar.

## Reglas del wargame implementadas parcialmente

4. **Regla B8 (no evaluar a tu invitado directo).** Implementada como función pura testeada
   (`lib/rules.ts`, `rules.test.ts`) y aplicada en `approveMilestone`, **con excepción Stage 0**:
   el founder es el único supervisor seed e invitó a toda la cohorte, así que aplicarla
   literalmente bloquearía todos los pagos. Decisión a ratificar: cuando entren guardianes
   seed distintos del founder, quitar la excepción.
5. **Cross-review aleatorio del 10% al cierre de periodo.** No implementado en v0.1 (no hay
   cierre de periodo con merkle root en la UI todavía). El merkle root determinista está
   disponible como utilidad (`lib/crypto.ts` `merkleRoot`), listo para el cierre de época.
6. **Cierre de periodo + merkle root anclado.** La estructura existe (`periods`, `anchor_queue`
   soporta `kind='merkle_root'`), pero el botón de "cerrar época" del admin queda para la
   siguiente iteración. Hoy los puntos se emiten por aprobación de hito.
7. **Verificación de firma del CLA.** Para wallets demo, el servidor puede verificar la firma
   ed25519 (keypair reconstruido). Para Freighter, la firma se guarda sin verificación estricta
   (el formato de `signMessage` varía entre versiones). Endurecer cuando se fije la versión de
   `@stellar/freighter-api`.

## Producto / diseño

8. **Tier derivado vs. almacenado.** El wargame pide derivar el tier de la reputación. Hoy el
   tier es una columna (`users.tier`, default Bronze; founder Gold) por simplicidad. Deuda:
   derivarlo por umbrales de reputación.
9. **Rate limiting en memoria.** No es global en serverless multi-instancia. Para producción,
   mover a Redis/Upstash. Suficiente para la cohorte Génesis.
10. **Freighter real.** El flujo se probó con la wallet de prueba (sandbox sin navegador). Falta
    validar el camino Freighter en un navegador con la extensión instalada (RECON R2 del wargame).
11. **Check-in QR de ritos (proof-of-attendance)** y **estatus alumni activable** están modelados
    parcialmente (columna `status`) pero sin UI. Pospuesto.
12. **CLA-check en CI real.** El `ci.yml` existente no se modificó (respeto a los archivos de
    gobernanza). El job de CLA sigue siendo un placeholder; conectar contra `cla_signatures`
    (export `cla-signers.json` desde el worker) queda pendiente (wargame M8).

## Testnet / operación

13. **Fondear la cuenta de servicio.** El worker lo hace con friendbot al arrancar. Si friendbot
    está caído >48h, la cola queda en pausa (degradación esperada, no bloquea el onboarding).

## Limpieza manual pendiente (mount bloqueó borrados)

- La copia canónica de rutas es `apps/web/app/` y `apps/web/middleware.ts` (raíz). **Borra manualmente** `apps/web/src/app/` y `apps/web/src/middleware.ts` (duplicados ignorados por Next, pero confunden). También puedes borrar `apps/web/node_modules` parcial si existe.
- `better-sqlite3` es opcional: si no compila, la app usa `node:sqlite` (Node >= 22) automáticamente. Cero configuración.
js.org`) devuelve 403. En tu máquina, `npm install` baja el binario prebuilt de
  better-sqlite3 desde GitHub (o compila con headers disponibles) y funciona normal.

Lo que **sí** se verificó en el sandbox:

- Tests unitarios puros de la **máquina de estados** y de las **reglas B8 / presupuesto de
  época**: verdes (5/5) vía el runner nativo de Node.
- Parseo/sintaxis de 30/31 archivos `.ts`/`.mjs` sin JSX (el único "fallo" es un falso
  positivo de `node --check` sobre un `type` alias, es TS válido).

**Pendiente de correr en tu máquina** (todo el código está escrito y listo):
`npm install` · `npm run build` · `npm test` (incluye `invites.test.ts` y `academia.test.ts`,
que cubren doble-uso de invitación y quiz-antes-de-tiempo) · `next start` + smoke de rutas.
Si `node_modules` quedó parcial en el repo, bórralo y corre `npm install` limpio.
