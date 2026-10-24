# Documentación del sistema por features

Aquí vive la auditoría del sistema feature por feature, con el método de la "Guía para documentar el sistema por features" (14 de octubre de 2026). Cada feature deja tres entregables:

1. Un **DFD** en el formato del ejercicio de clase (Microsoft Threat Modeling Tool 4.3): fuente en `docs/dfd/<feature>.json`, modelo `docs/dfd/<feature>.tm7` e imagen `docs/dfd/<feature>.svg`, generados con `docs/dfd/generar_tm7.py` (ver [`docs/dfd/README.md`](../dfd/README.md)).
2. Una **ficha** `docs/features/<feature>.md` que ubica cada elemento del diagrama en el código (archivo y función).
3. Una **prueba de caracterización** del flujo principal, `apps/web/src/lib/caracterizacion/<feature>.test.ts`, que protege el comportamiento actual y pasa.

Empieza por [`00-esqueleto.md`](00-esqueleto.md): arranque, carpetas, rutas, sesión, base de datos, servicios externos, logs, pruebas y el DFD nivel 0 del sistema.

El resultado de la primera vuelta (hallazgos consolidados, propuesta de organización y plan semanal del QA) está en [`docs/auditoria/2026-10-21-auditoria.md`](../auditoria/2026-10-21-auditoria.md).

## Índice

Estado al 2026-10-21 (commit de referencia `0e07d8f`). Los 17 entregables están escritos e integrados y cumplen los criterios 1 a 5 de abajo; falta el 6 (que otra persona lea la ficha) y abrir cada `.tm7` en Microsoft Threat Modeling Tool. Por eso todos siguen en `Borrador` hasta su semana en el [plan del QA](../auditoria/2026-10-21-auditoria.md#7-plan-de-las-próximas-sesiones-del-qa). Los hallazgos consolidados, sin repetidos, están en el [reporte de la auditoría](../auditoria/2026-10-21-auditoria.md).

Dueño y revisor los llena el QA. Estados: `Pendiente`, `Borrador` (entregables escritos, sin revisar), `En revisión`, `Terminado` (cumple los seis criterios de abajo). Amenazas: Mitigadas / Aceptadas / Pendientes de la sección 7.

| # | Feature | Ficha | DFD | Prueba (casos) | Amenazas M / A / P | Hallazgos principales | Dueño | Revisor | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Paso 0: esqueleto común | [00-esqueleto.md](00-esqueleto.md) | [json](../dfd/00-sistema.json) · [tm7](../dfd/00-sistema.tm7) · [svg](../dfd/00-sistema.svg) | No aplica | No aplica | [M25](../auditoria/2026-10-21-auditoria.md#media), [M26](../auditoria/2026-10-21-auditoria.md#media), [B18](../auditoria/2026-10-21-auditoria.md#baja), [B19](../auditoria/2026-10-21-auditoria.md#baja), [B20](../auditoria/2026-10-21-auditoria.md#baja) | QA (por asignar) | John | Borrador |
| 1 | Login y sesión | [login-y-sesion.md](login-y-sesion.md) | [json](../dfd/login-y-sesion.json) · [tm7](../dfd/login-y-sesion.tm7) · [svg](../dfd/login-y-sesion.svg) | [16](../../apps/web/src/lib/caracterizacion/login-y-sesion.test.ts) | 12 / 3 / 7 | [A1](../auditoria/2026-10-21-auditoria.md#alta), [M1](../auditoria/2026-10-21-auditoria.md#media), [M2](../auditoria/2026-10-21-auditoria.md#media), [M3](../auditoria/2026-10-21-auditoria.md#media), [M4](../auditoria/2026-10-21-auditoria.md#media), [M5](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 2 | Dashboard | [dashboard.md](dashboard.md) | [json](../dfd/dashboard.json) · [tm7](../dfd/dashboard.tm7) · [svg](../dfd/dashboard.svg) | [7](../../apps/web/src/lib/caracterizacion/dashboard.test.ts) | 8 / 3 / 2 | [M8](../auditoria/2026-10-21-auditoria.md#media), [M10](../auditoria/2026-10-21-auditoria.md#media), [M15](../auditoria/2026-10-21-auditoria.md#media), [M17](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 3 | Actividades | [actividades.md](actividades.md) | [json](../dfd/actividades.json) · [tm7](../dfd/actividades.tm7) · [svg](../dfd/actividades.svg) | [9](../../apps/web/src/lib/caracterizacion/actividades.test.ts) | 9 / 2 / 2 | [M8](../auditoria/2026-10-21-auditoria.md#media), [M9](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 4 | Ágora y hitos | [agora-y-hitos.md](agora-y-hitos.md) | [json](../dfd/agora-y-hitos.json) · [tm7](../dfd/agora-y-hitos.tm7) · [svg](../dfd/agora-y-hitos.svg) | [4](../../apps/web/src/lib/caracterizacion/agora-y-hitos.test.ts) | 7 / 4 / 5 | [A5](../auditoria/2026-10-21-auditoria.md#alta), [A6](../auditoria/2026-10-21-auditoria.md#alta), [M6](../auditoria/2026-10-21-auditoria.md#media), [M11](../auditoria/2026-10-21-auditoria.md#media), [M22](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 5 | Gamificación y épocas | [gamificacion-y-epocas.md](gamificacion-y-epocas.md) | [json](../dfd/gamificacion-y-epocas.json) · [tm7](../dfd/gamificacion-y-epocas.tm7) · [svg](../dfd/gamificacion-y-epocas.svg) | [8](../../apps/web/src/lib/caracterizacion/gamificacion-y-epocas.test.ts) | 10 / 3 / 3 | [A6](../auditoria/2026-10-21-auditoria.md#alta), [M10](../auditoria/2026-10-21-auditoria.md#media), [M11](../auditoria/2026-10-21-auditoria.md#media), [M12](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 6 | Anclaje en Stellar | [anclaje-stellar.md](anclaje-stellar.md) | [json](../dfd/anclaje-stellar.json) · [tm7](../dfd/anclaje-stellar.tm7) · [svg](../dfd/anclaje-stellar.svg) | [6](../../apps/web/src/lib/caracterizacion/anclaje-stellar.test.ts) | 2 / 6 / 5 | [A4](../auditoria/2026-10-21-auditoria.md#alta), [M23](../auditoria/2026-10-21-auditoria.md#media), [M26](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 7 | Proyectos y membresías | [proyectos-y-membresias.md](proyectos-y-membresias.md) | [json](../dfd/proyectos-y-membresias.json) · [tm7](../dfd/proyectos-y-membresias.tm7) · [svg](../dfd/proyectos-y-membresias.svg) | [8](../../apps/web/src/lib/caracterizacion/proyectos-y-membresias.test.ts) | 8 / 2 / 3 | [M16](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 8 | Ritos y comunidad | [ritos-y-comunidad.md](ritos-y-comunidad.md) | [json](../dfd/ritos-y-comunidad.json) · [tm7](../dfd/ritos-y-comunidad.tm7) · [svg](../dfd/ritos-y-comunidad.svg) | [8](../../apps/web/src/lib/caracterizacion/ritos-y-comunidad.test.ts) | 8 / 2 / 4 | [A3](../auditoria/2026-10-21-auditoria.md#alta), [M20](../auditoria/2026-10-21-auditoria.md#media), [M21](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 9 | SLA, recordatorios y avisos | [sla-recordatorios-y-avisos.md](sla-recordatorios-y-avisos.md) | [json](../dfd/sla-recordatorios-y-avisos.json) · [tm7](../dfd/sla-recordatorios-y-avisos.tm7) · [svg](../dfd/sla-recordatorios-y-avisos.svg) | [12](../../apps/web/src/lib/caracterizacion/sla-recordatorios-y-avisos.test.ts) | 8 / 3 / 3 | [A9](../auditoria/2026-10-21-auditoria.md#alta), [M18](../auditoria/2026-10-21-auditoria.md#media), [M26](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 10 | Talento e importador | [talento-e-importador.md](talento-e-importador.md) | [json](../dfd/talento-e-importador.json) · [tm7](../dfd/talento-e-importador.tm7) · [svg](../dfd/talento-e-importador.svg) | [7](../../apps/web/src/lib/caracterizacion/talento-e-importador.test.ts) | 10 / 3 / 1 | [M9](../auditoria/2026-10-21-auditoria.md#media), [M15](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 11 | Clientes y grafo | [clientes-y-grafo.md](clientes-y-grafo.md) | [json](../dfd/clientes-y-grafo.json) · [tm7](../dfd/clientes-y-grafo.tm7) · [svg](../dfd/clientes-y-grafo.svg) | [5](../../apps/web/src/lib/caracterizacion/clientes-y-grafo.test.ts) | 6 / 4 / 3 | [A8](../auditoria/2026-10-21-auditoria.md#alta), [M24](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 12 | Telegram | [telegram.md](telegram.md) | [json](../dfd/telegram.json) · [tm7](../dfd/telegram.tm7) · [svg](../dfd/telegram.svg) | [12](../../apps/web/src/lib/caracterizacion/telegram.test.ts) | 8 / 3 / 4 | [A8](../auditoria/2026-10-21-auditoria.md#alta), [M9](../auditoria/2026-10-21-auditoria.md#media), [M19](../auditoria/2026-10-21-auditoria.md#media), [M20](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 13 | Genoma y gobernanza | [genoma-y-gobernanza.md](genoma-y-gobernanza.md) | [json](../dfd/genoma-y-gobernanza.json) · [tm7](../dfd/genoma-y-gobernanza.tm7) · [svg](../dfd/genoma-y-gobernanza.svg) | [7](../../apps/web/src/lib/caracterizacion/genoma-y-gobernanza.test.ts) | 7 / 2 / 5 | [A7](../auditoria/2026-10-21-auditoria.md#alta), [M13](../auditoria/2026-10-21-auditoria.md#media), [M14](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 14 | Admin del founder | [admin.md](admin.md) | [json](../dfd/admin.json) · [tm7](../dfd/admin.tm7) · [svg](../dfd/admin.svg) | [19](../../apps/web/src/lib/caracterizacion/admin.test.ts) | 7 / 2 / 7 | [A5](../auditoria/2026-10-21-auditoria.md#alta), [A6](../auditoria/2026-10-21-auditoria.md#alta), [M3](../auditoria/2026-10-21-auditoria.md#media), [M6](../auditoria/2026-10-21-auditoria.md#media), [M7](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 15 | Academia | [academia.md](academia.md) | [json](../dfd/academia.json) · [tm7](../dfd/academia.tm7) · [svg](../dfd/academia.svg) | [13](../../apps/web/src/lib/caracterizacion/academia.test.ts) | 7 / 3 / 6 | [A2](../auditoria/2026-10-21-auditoria.md#alta), [M2](../auditoria/2026-10-21-auditoria.md#media), [M8](../auditoria/2026-10-21-auditoria.md#media), [M14](../auditoria/2026-10-21-auditoria.md#media), [M20](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |
| 16 | Sitio público y formularios | [sitio-publico-y-formularios.md](sitio-publico-y-formularios.md) | [json](../dfd/sitio-publico-y-formularios.json) · [tm7](../dfd/sitio-publico-y-formularios.tm7) · [svg](../dfd/sitio-publico-y-formularios.svg) | [26](../../apps/web/src/lib/caracterizacion/sitio-publico-y-formularios.test.ts) | 9 / 0 / 5 | [A3](../auditoria/2026-10-21-auditoria.md#alta), [A10](../auditoria/2026-10-21-auditoria.md#alta), [M1](../auditoria/2026-10-21-auditoria.md#media), [M20](../auditoria/2026-10-21-auditoria.md#media), [M27](../auditoria/2026-10-21-auditoria.md#media) | QA (por asignar) | John | Borrador |

Totales: 17 DFD (433 elementos y 652 flujos, todos atados al código), 236 amenazas (126 mitigadas, 45 aceptadas y 65 pendientes) y 167 pruebas de caracterización en verde.

El porqué de este orden está en la sección 5 de [`00-esqueleto.md`](00-esqueleto.md): primero lo que todos usan, luego lo que toca puntos (el equivalente a dinero aquí), estados, sincronizaciones y mensajes salientes, y al final lo periférico. Si aparece una dependencia no prevista, se anota en la sección 6 de las dos fichas y no se interrumpe el orden.

## Orden de trabajo

El QA marca cada casilla cuando entrega el DFD, la ficha y la prueba de ese punto.

- [ ] **Paso 0, esqueleto común:** DFD general y tabla de preguntas.
- [ ] **Login y sesión**
- [ ] **Dashboard**
- [ ] **Actividades**
- [ ] **Siguientes features**, en el orden del índice: Ágora y hitos, Gamificación y épocas, Anclaje en Stellar, Proyectos y membresías, Ritos y comunidad, SLA, recordatorios y avisos, Talento e importador, Clientes y grafo, Telegram, Genoma y gobernanza, Admin, Academia, Sitio público y formularios.

## Criterios de terminado

Un feature se da por documentado cuando cumple los seis:

1. El DFD está guardado en `docs/dfd/` y exportado como imagen.
2. Cada elemento del DFD tiene archivo y función en la sección 4 de la ficha.
3. Los flujos con datos sensibles (credenciales, pagos, datos personales) están identificados.
4. Las amenazas relevantes tienen estado y justificación, no solo el valor `AutoGenerated`.
5. Existe una prueba que cubre el flujo principal y pasa.
6. Otra persona del equipo leyó la ficha y entendió el recorrido sin ayuda.

| Feature | 1. DFD e imagen | 2. Elementos en el código | 3. Flujos sensibles | 4. Amenazas con estado | 5. Prueba pasa | 6. Leída por otra persona |
| --- | --- | --- | --- | --- | --- | --- |
| 00-esqueleto | ☑ | ☑ | ☑ | No aplica | No aplica | ☐ |
| login-y-sesion | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| dashboard | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| actividades | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| agora-y-hitos | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| gamificacion-y-epocas | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| anclaje-stellar | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| proyectos-y-membresias | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| ritos-y-comunidad | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| sla-recordatorios-y-avisos | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| talento-e-importador | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| clientes-y-grafo | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| telegram | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| genoma-y-gobernanza | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| admin | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| academia | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |
| sitio-publico-y-formularios | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ |

Evidencia de las casillas marcadas (integración del 2026-10-21): (1) `python docs/dfd/generar_tm7.py --todos --estricto` generó los 17 `.tm7` y `.svg` sin errores; (2) los 433 elementos tienen `archivo#símbolo` comprobado con `grep` y aparecen en la sección 4 de su ficha; (3) cada flujo marcado `sensible` en el JSON sale en rojo y con `*` en el diagrama y está en la sección 5; (4) las 236 amenazas tienen estado y justificación; (5) `npx vitest run src/lib/caracterizacion` pasa con 16 archivos y 167 pruebas. El detalle está en la sección 9 del [reporte](../auditoria/2026-10-21-auditoria.md#9-cómo-se-verificó-esta-auditoría).

Para marcar una casilla, cambia `☐` por `☑` en el mismo pull request que deja la evidencia (el `.svg` regenerado, la prueba en verde, el nombre de quien leyó la ficha en su encabezado).

## Cómo se trabaja un feature

1. Dibujar el DFD desde lo que se conoce como usuario, antes de abrir el código.
2. Ubicar en el repo el punto de entrada de la acción elegida: pantalla (`apps/web/app/**/page.tsx`), endpoint (`apps/web/app/api/**/route.ts`) y la función de `apps/web/src/lib/` que hace el trabajo.
3. Escribir o corregir `docs/dfd/<feature>.json` y regenerar: `python docs/dfd/generar_tm7.py docs/dfd/<feature>.json --estricto`. El modo estricto falla si un `codigo` apunta a un archivo o símbolo que no existe.
4. Copiar en la sección 2 de la ficha el bloque Mermaid que imprime `python docs/dfd/generar_tm7.py docs/dfd/<feature>.json --mermaid` (GitHub lo dibuja).
5. Llenar la ficha con la plantilla de abajo. En la sección 7, cada amenaza lleva estado `Mitigada`, `Aceptada` o `Pendiente`; las dos primeras con justificación concreta (archivo:línea del control que la mitiga, o por qué se acepta).
6. Escribir la prueba de caracterización contra una base SQLite temporal (`openDb(":memory:")` + `schema.sql`, como las pruebas de `apps/web/src/lib/*.test.ts`) y correrla: `cd apps/web && npx vitest run src/lib/caracterizacion/<feature>.test.ts`. Protege el comportamiento actual; no lo cambia.

## Plantilla de ficha

```markdown
# Ficha: <Feature>

Dueño: <nombre> · Revisor: <nombre> · Fecha: <AAAA-MM-DD> · Commit de referencia: <hash>

## 1. Resumen
Qué hace, quién lo usa y qué casos de uso cubre.

## 2. Diagrama (DFD)
Archivo: docs/dfd/<feature>.tm7 (más una imagen exportada).

## 3. Recorrido de una acción
Acción elegida: <ej. el usuario ingresa correo y contraseña>
1. Pantalla o componente:
2. Llamada al backend (endpoint y datos enviados):
3. Ruta y controlador:
4. Lógica de negocio (validaciones, permisos, cálculos):
5. Base de datos (tablas o modelos leídos y escritos):
6. Respuesta y qué hace la pantalla con ella:
7. Casos de falla:

## 4. Elementos del DFD en el código
| Elemento | Tipo | Archivo y función | Notas |
| --- | --- | --- | --- |

## 5. Flujos de datos
| Flujo | De → a | Protocolo | Datos que viajan |
| --- | --- | --- | --- |

## 6. Dependencias con otras features

## 7. Amenazas relevantes
| Amenaza | Categoría | Elemento | Estado | Justificación |
| --- | --- | --- | --- | --- |

## 8. Prueba de caracterización
Archivo de la prueba y qué flujo cubre.

## 9. Preguntas abiertas
```

En la sección 2, además del enlace al `.tm7`, va el bloque Mermaid y el enlace al `.svg`. El repo es público: ni en las fichas ni en los JSON van nombres de clientes, correos, secretos ni datos de producción.
