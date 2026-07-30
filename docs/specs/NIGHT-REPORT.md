# NIGHT-REPORT — Release v1 "Organizar" · loop del 2026-07-30

**TL;DR:** los **5 WPs del núcleo congelado están implementados**: WP14 y WP15 completos, y WP13, WP16 y WP19 con su scaffolding completo y testeado detrás de flag, esperando solo tus credenciales. Estado final de la rama: **`npx vitest run` 381/381 · `tsc --noEmit` limpio · `next lint` sin errores · `next build` verde**.

Se ejecutaron 3 olas con subagentes en worktrees aislados (WP14 ∥ WP16 → WP15 ∥ WP13 → WP19), con integración y suite completa verde entre olas. `FEEDBACK.md` estaba vacío → no hubo ítems `FBxx`.

> **Nada desplegado, nada en `main`, nada en mainnet, ningún `.env*` tocado, ningún secreto en el repo ni en la base.**

---

## 0. Tres cosas que había que resolver antes de empezar (léelas primero)

1. **Los specs de v1 no estaban versionados.** `WP13`–`WP19`, los planos 05/06/07 y `DESPLIEGUE-V1.md` existían solo como **archivos sin trackear** en el checkout principal. Este worktree no los tenía. Los traje al repo en `8a0c7b1`.

2. **Este worktree salía del baseline pelado de `main`** (`4524dff`), sin nada de WP01–WP12. Lo llevé por fast-forward a `develop` (`7ea185a`) antes de tocar código. *(Dos de los subagentes arrancaron también en el baseline viejo; lo detectaron solos y se rebasaron sobre la punta de integración — está en sus decisiones.)*

3. **El prompt de lanzamiento pide "driver Postgres de WP16" y eso está desactualizado.** Tu decisión firme es **Azure SQL Database con driver `mssql`**, y está escrita en tres sitios (`CLAUDE.md` línea 3, `QUEUE.md` línea 55, `DESPLIEGUE-V1.md` parte B punto 4). El texto "Postgres" sobrevive en la línea *RESULTADO ESPERADO* del propio `WP16-deploy-azure.md` y en su punto de backups. **Se implementó Azure SQL / `mssql`.** Conviene limpiar esas dos líneas del spec para que nadie vuelva a dudar.

---

## 1. Qué se hizo (por WP)

| WP | Estado | Resumen | Commit |
|---|---|---|---|
| WP14 | ✅ **done** | Iniciativas + asignaciones + `assignment_events` (append-only) + check-in diario. Máquina de estados **pura** propia (`Backlog → Asignada → En curso → En revisión → Hecha` + rama `Bloqueada`). Importador CSV idempotente. `/equipo/hoy`, `/equipo/proyectos` | `cb49bc7` |
| WP15 | ✅ **done** | `/equipo/dashboard`: **bloqueos primero** (días derivados de los eventos), bandeja "esperando a John" (`needs_founder`), por iniciativa, carga por persona, salud de ritos, métricas de época, **digest diario exportable** en texto plano | `fc6975c` |
| WP13 | 🔶 **needs_human** | Scaffolding **completo y testeado** tras flag `AUTH_ENTRA_ENABLED` (apagado): NextAuth v4 + provider Entra, validación de `tid`, `user_emails`, vinculación al roster **sin mutar la PK**, banner de segundo correo | `fb722d1` |
| WP16 | 🔶 **needs_human** | Driver **`mssql`/Azure SQL** tras la misma interfaz de `lib/db.ts` + traductor de dialecto T-SQL + **puente síncrono** (`worker_threads` + `Atomics.wait`) probado contra un backend asíncrono falso. Azure documentado (costos, red, managed identity) | `b8328b2` |
| WP19 | 🔶 **needs_human** | Scaffolding tras flag `TELEGRAM_ENABLED` (apagado): **5 herramientas cerradas**, borradores con `Confirmar/Editar/Descartar` (**nada se crea sin confirmar**), `telegram_links` con código **hasheado**, webhook con secret en tiempo constante, log `bot_actions` en admin, **hora de los 3 focos en el genoma** | `fe45bc1` |

WP17 y WP18 **no se tocaron**: están congelados a v1.1 hasta que se cumplan tus 4 criterios de USO. WP04, WP06 y WP10 tampoco (no son v1).

---

## 2. Lo que encontró la ejecución en paralelo (el valor de correr los WPs por separado)

**Un bug cruzado real, encontrado por WP13 dentro del código de WP16** — el tipo de fallo que no aparece haciendo los WPs de uno en uno:

> `lib/sql-dialect.ts` **descartaba en silencio** todo lo que siguiera a la lista de columnas de un `CREATE INDEX`, incluida una cláusula `WHERE`. Es decir: un índice **parcial** de SQLite se emitía a Azure SQL como índice **sin filtro**. Y un `UNIQUE` sobre columna *nullable* pasa en SQLite (admite varios NULL) pero **rompe en SQL Server**, que trata los NULL como iguales y solo admite UNA fila. Habría fallado **en producción, al dar de alta al segundo usuario sin vincular**, y contradecía la regla de diseño declarada en la cabecera del propio archivo ("lo que no se pueda traducir con fidelidad, LANZA").

Corregido en `18728ce`: el `WHERE` ahora se traduce (índice filtrado en T-SQL) y cualquier otra cola lanza `UnsupportedSqlError`. Con el bug cerrado, la unicidad de `entra_oid` **volvió al esquema** como índice parcial único — la forma portable que WP13 quería y había descartado *solo* por ese bug. WP19 adoptó después el mismo patrón para sus tablas por su cuenta.

Otros tres arreglos de integración, en archivos que ningún agente tenía permitido tocar:

- **`cohortStats()` contaba los 6 placeholders `pending:*` del roster interno como cohorte pública de la DAO**: la home anunciaba 10 contribuidores en vez de 4. Excluidos, con test que fija la frontera en los dos sentidos (`16f0113`).
- **`/equipo` no estaba en el middleware.** Añadido como `PROTECTED_SESSION` (solo sesión, **sin** exigir `claSigned`): el core entra por Entra y firma el CLA *después*, así que exigirlo habría dejado al equipo fuera de su propio tablero.
- **El banner del segundo correo solo estaba montado en `/entrar`**, así que "persistente" no lo era. Nuevo `app/equipo/layout.tsx` lo monta en todo `/equipo`, que es donde el equipo pasa el día.

Y un hallazgo de WP15 que **sigue abierto** (ver §5): `seed.ts` crea un founder de *demostración* que el sembrado del roster promueve a `role='founder'`, así que **John aparece dos veces** y la salud del rito dividía entre 7 personas en vez de 6. WP15 lo filtró en su propia capa (`is_demo = 1`), pero el origen no está arreglado.

---

## 3. Decisiones que conviene que ratifiques

1. **`assignments.owner_wallet`, no `owner_id`.** El spec de WP14 pedía `owner_id`, pero la PK real de `users` es `wallet TEXT` y todo el esquema referencia usuarios así. Un id entero habría exigido una tabla puente.
2. **`role` + `is_supervisor` como flag SEPARADO.** El plano 07 §5 dice que los supervisores del dashboard son John y Vale, pero **Vale es `core`**. Si supervisor fuera un valor de `role`, Vale no podría ser las dos cosas.
3. **La PK de `users` NUNCA muta.** Quien está en el roster se **vincula** a su fila `pending:<slug>` al entrar por Entra (se escribe `entra_oid` + correo en `user_emails`), no se le reescribe el principal: hay asignaciones, eventos y check-ins colgando de él. Es también lo que hace verdadero el criterio 5 de WP13 ("un humano = UN registro").
4. **NextAuth v4 estable, no la v5 beta**, con el `id` del provider sobreescrito a `microsoft-entra-id` para que la Redirect URI sea **exactamente** la de tu paso A1 — no tienes que cambiar nada en el app registration. Además se sobreescribe `profile()` porque el provider por defecto **llama a Microsoft Graph** (foto de perfil) en cada login, y Graph está en el NO-alcance de v1.
5. **Puente síncrono con `worker_threads` + `Atomics.wait` para Azure SQL.** `mssql`/tedious es solo asíncrono y no existe cliente síncrono de Azure SQL para Node; `lib/db.ts` es síncrono por contrato y el spec prohíbe tocar la lógica de negocio (la misma trampa que WP03 con `@libsql/client`). La alternativa era reescribir toda la app como asíncrona.
6. **Las fechas siguen guardándose como texto** `'YYYY-MM-DD HH:MM:SS'` vía `CONVERT(NVARCHAR(19), SYSUTCDATETIME(), 120)` en vez de migrar a `datetime2`: la app compara fechas como cadenas y `datetime2` usa separador `T`, que **ordena distinto** y habría roto el vencimiento de invitaciones en silencio.
7. **El bot tiene exactamente 5 herramientas, y el backlog conversacional NO es una de ellas.** "Cierra esto" y "sube la prioridad" se resolvieron como **comandos deterministas** que no pasan por el modelo: menos superficie generativa, menos coste, y respuestas idénticas a las de la web. "Ciérralo" avanza **un paso legal por vez**, sin saltarse la máquina de estados.
8. **Al genoma fue solo la hora de los 3 focos** (`DAILY_FOCUS_HOUR`). El umbral de confianza del bot (0.6) y el TTL del código de alta (30 min) **no** son parámetros del sistema: no reparten nada ni tocan épocas. Prioridades y horizontes tampoco (son vocabulario, no números que muten).
9. **Deviación de protocolo: no hay merge a `develop`.** El protocolo pide rama por WP desde `develop` y merge a `develop`. Los 5 WPs sí tienen su rama `wp/XX-*` y su commit convencional, pero están merjeados en **`claude/release-v1-wp-processing-86aa24`**, no en `develop`: tu checkout principal tiene `develop` activo y git no permite merjear sobre una rama que está en uso en otro worktree. Ver §7 para integrarlo.
10. **`docs/specs/NIGHT-REPORT.md` del 24-jul se archivó** como `NIGHT-REPORT-2026-07-24.md` (contiene decisiones tuyas aún sin ratificar, como la de `.env.example`).

---

## 4. Lo que falta de ti (y solo de ti)

| # | Qué | Desbloquea |
|---|---|---|
| A1 | App registration en Entra → `AZURE_AD_CLIENT_ID`, `_SECRET`, `_TENANT_ID` + `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Encender WP13 |
| A2 | Suscripción y recursos Azure (App Service, Azure SQL, firewall, managed identity) | Desplegar WP16 |
| A3 | Bot con @BotFather + `ANTHROPIC_API_KEY` + `TELEGRAM_WEBHOOK_SECRET` | Encender WP19 |
| A4 | Decisión: **proveedor de transcripción de audio** (ver §5) | Audio del bot |
| A4 | Confirmar supervisores (el código asume **John + Vale**, plano 07 §5) | — |

Todas las variables están documentadas en **`docs/deploy.md`** (secciones nuevas de WP13 y WP19), **nunca en `.env*`**.

---

## 5. Huecos declarados (ninguno tapado)

1. **Azure SQL nunca se ha ejecutado de verdad.** Nadie ha corrido el T-SQL generado contra el motor. Está probado el traductor (38 tests, y se revisaron **una por una las 125 sentencias SQL reales de la app** — de ahí salieron 3 traducciones que el spec no listaba: `SET IDENTITY_INSERT`, `CASE WHEN` escalar y alias en tablas derivadas) y el puente síncrono (19 tests contra un backend asíncrono falso). Lo que falta es el cable tedious→instancia: es tu paso 6. Plan de verificación en `docs/deploy.md` §"Qué queda por verificar contra la instancia real".
2. **Transcripción de audio (WP19).** La API de Claude **no transcribe audio** y no hay proveedor decidido. Está construida la costura (`interface Transcriber`, inyectable y mockeada) y el flujo completo funciona sobre texto; un audio real recibe una respuesta honesta ("todavía no puedo convertir audio a texto"), no un fingimiento. **Decisión tuya**, y ojo: implica si el audio sale del entorno de la DAO.
3. **`client_id` / clasificación por cliente (WP19).** No se puede cumplir en v1: **WP17 está congelado** y crear la tabla de clientes lo habría violado. Se clasifica por `initiative_id`; un nombre desconocido queda sin resolver y se dice, en vez de crear una iniciativa de contrabando.
4. **John duplicado en el seed** (hallazgo de WP15, **sin arreglar en el origen**): el founder demo y `pending:john` son la misma persona en dos filas. WP15 lo filtra por `is_demo`, pero cuando entres por Entra vas a vincularte a `pending:john` y seguirán existiendo dos registros. Arreglarlo toca el sembrado de identidad y preferí no reestructurarlo sin tu criterio. **Es lo primero que revisaría** de cara a la coherencia del "un humano = UN registro".
5. **`anchor-worker.mjs` no leerá Azure SQL.** Abre SQLite directamente sin pasar por `lib/db.ts`, así que el criterio "worker anclando desde Azure" no se cumple solo con desplegar. Arreglo sugerido: migrarlo a `lib/db.ts` o darle su propio cliente `mssql` asíncrono (en un script suelto el async es trivial).
6. **Rate limiting sigue en memoria por proceso**: solo es un control real con **una** instancia de App Service. Documentado con su regla de migración a Redis; no implementado (fuera de alcance).
7. **No hay migraciones.** `schema.sql` se aplica con `CREATE TABLE IF NOT EXISTS`, que **no** añade columnas a una base existente. Las olas de v1 añadieron columnas a `users`. **Borra la base local antes de arrancar** (comandos en `DESPLIEGUE-V1.md`, paso 7). En Azure, un `ALTER TABLE` explícito si la base ya existía.
8. **Los 3 focos del día**: el "ya envié hoy" vive en memoria del script de polling, así que un reinicio el mismo día puede reenviarlos una vez. En Azure hará falta un disparador real (cron/timer) y persistir el último día enviado.
9. **`assignment_events` sin `En revisión → En curso`**: si una entrega no cumple su criterio, hoy no hay camino de vuelta (solo bloquear con motivo). WP14 lo dejó fuera porque el spec dice "sin saltos", pero **es el primer hueco que vas a sentir usándolo**. Candidato a `FB01`.
10. **No hay formulario web para crear asignaciones**: entran por el importador CSV o por el bot. El spec no lo pedía. Si quieres crearlas desde la web antes de encender el bot, hace falta un mini-spec.
11. **`bot_actions` crece sin purga** y guarda el `telegram_user_id` crudo de remitentes **no** registrados (lo mínimo para diagnosticar un id desconocido que insiste; sin contenido). Si prefieres no tenerlo, se cambia por un contador.
12. **Tests de rutas HTTP**: la autorización y el secret del webhook están testeados **a nivel de función**, no como test de integración de la ruta — el repo no tiene ese patrón y ningún agente quiso introducirlo en su rama. La página del dashboard además renderiza un 403 visual pero responde HTTP 200 (límite del App Router).
13. **`npm audit`** sigue reportando vulnerabilidades heredadas de dependencias transitivas. No se tocaron. Revisar antes del despliegue público.

---

## 6. Qué revisar en localhost

```bash
rm -f apps/web/data/zelena.db apps/web/data/zelena.db-shm apps/web/data/zelena.db-wal
npm install
npm run dev
```

Login demo: código `GENESIS-0001` + "Usar wallet de prueba". Los flags de Entra y Telegram están **apagados**, así que entras por la puerta de invitación de siempre.

- **`/equipo/hoy` (WP14)** — la pantalla que abrirá cada persona. Acciones de un click; **bloquear exige motivo** (el botón está deshabilitado sin él); bloque "Tu progreso" comparándote contigo. Un `core` ve solo lo suyo.
- **`/equipo/proyectos` (WP14)** — por iniciativa, con filtro por horizonte. Ojo: el horizonte se filtra por **asignación**, no por iniciativa, porque en tus CSV reales una misma iniciativa tiene filas en horizontes distintos.
- **`/equipo/dashboard` (WP15)** — entra como founder. **Bloqueos arriba**, con días calculados desde el evento. Prueba el recorrido completo: bloquea algo en `/equipo/hoy` → recárgalo aquí. Baja al **digest** y cópialo/descárgalo. Entra como `core` y comprueba que te lo niega.
- **Importar tu CSV real** — con `--dry-run` primero (comandos en `DESPLIEGUE-V1.md` §"Comandos reales del paso 7"). Es idempotente y **no pisa** el estado de lo que el equipo ya movió.
- **`/admin` (WP19)** — sección nueva con el log de `bot_actions` (vacío hasta que enciendas el bot).
- **`/` (home)** — confirma que la cohorte pública dice **4**, no 10.

Lo que **no** puedes probar hasta tener credenciales: el login real de Entra, el bot real y Azure SQL.

---

## 7. Cómo integrar esto

El trabajo está en **`claude/release-v1-wp-processing-86aa24`** (punta: el commit de este reporte), con los 5 WPs en sus ramas `wp/13-entra`, `wp/14-equipo`, `wp/15-dashboard`, `wp/16-azure`, `wp/19-telegram`.

Tu checkout principal tiene **`develop` activo y con cambios sin commitear** (`CLAUDE.md`, `QUEUE.md`, el plano 01 y los specs sin trackear). **Esos archivos ya están commiteados en mi rama y son idénticos** — verificado uno por uno; las dos únicas excepciones son `DESPLIEGUE-V1.md` y `QUEUE.md`, que **extendí a propósito** (comandos de importación y registro de cierres). Así que puedes descartar las copias del working tree sin perder nada:

```bash
git checkout -- CLAUDE.md docs/blueprints/01-arquitectura.md docs/specs/QUEUE.md
```

Después, desde el checkout principal (con `develop` activo):

```bash
git merge --no-ff claude/release-v1-wp-processing-86aa24
```

Los specs sin trackear (`docs/specs/WP13..WP19.md`, planos 05/06/07, `DESPLIEGUE-V1.md`) llegarán por el merge; si git se queja de que sobreescribiría archivos sin trackear, bórralos antes — el contenido es el mismo.

No hice el merge yo: git no permite merjear sobre una rama que está en uso en otro worktree, y no me pareció correcto tocar el estado de tu checkout.

---

## 8. Verificación final de esta rama

```
npx vitest run     → 381/381 (28 archivos)
npx tsc --noEmit   → limpio
npx next lint      → sin errores
npx next build     → verde (15 páginas)
```

Progresión por ola: 77 (baseline) → 211 (ola 1) → 283 (ola 2) → **381** (ola 3).

**Guardrails respetados:** no se tocó `main`, ni mainnet, ni fondos, ni migraciones, ni `.env*`. No hay endpoint de transferencia de puntos. Los ledgers siguen append-only y todo se deriva por `SUM()`. La máquina de estados de proyectos del Ágora no se modificó (la del equipo es una **segunda** función pura, aparte). Cero secretos en el repo y cero en la base: el código de alta del bot se guarda **hasheado** y ningún token se persiste. Copys auditados con la regla del doc 16 en los tres WPs de UI, con tests de vocabulario prohibido.

---

*Generado por el loop autónomo. Siguiente paso natural: revisa localhost, escribe lo que no te guste en `docs/specs/FEEDBACK.md` (`- [ ] página: qué mejorar`) y relanza — los `FBxx` tienen prioridad sobre todo.*
