# WP19 · Asistente personal de Telegram para John (agente de backlog)

CONTEXTO — Decisión de John (actualizada): el equipo SÍ trabaja en el tablero web con su login (WP13–WP15). Telegram es el asistente personal de John: capturar tareas y pendientes por cliente o proyecto desde reuniones o en movimiento, gestionar su propio backlog y ayudarle a priorizar. La dapp sigue siendo la única fuente de verdad. Filosofía: seguimiento **por objetivos, no por horas**.

PROBLEMA — John captura tareas en reuniones y se pierden; su backlog personal vive en la cabeza; priorizar requiere sentarse frente al computador.

RESULTADO ESPERADO — John le habla al bot ("asigna a David: dashboard de bloqueos para el viernes", "pendiente con Hogar Center: revisar propuesta de analítica") y la asignación/pendiente existe en la dapp, clasificada por cliente o proyecto; el bot le ayuda a revisar y priorizar su día.

## Arquitectura

```
Telegram ──webhook──▶ /api/telegram/webhook (misma app Next.js, mismo App Service)
                          │ 1. valida secret token del webhook
                          │ 2. resuelve telegram_user_id → usuario dapp
                          │ 3. Claude API (tool use) clasifica y estructura el mensaje
                          ▼
                     acciones sobre la DB existente:
                     assignments (WP14) · checkins (WP14) · notes (nuevo) · evidence (nuevo)
```

- **Sin infraestructura nueva**: el webhook es una ruta más de la dapp. Telegram Bot API es gratis.
- **Claude API** (modelo económico, p. ej. Haiku) con herramientas definidas: `crear_asignacion`, `registrar_checkin`, `guardar_nota`, `consultar_estado`, `no_entendido`. El bot NUNCA ejecuta nada fuera de esas 5 herramientas.
- **Identidad**: tabla `telegram_links (user_id, telegram_user_id, linked_at)`. Registro: la dapp genera un código de un solo uso; la persona envía `/start CODIGO` al bot. Mensajes de IDs no registrados se ignoran (y se registran en log).

## Alcance v1 — El agente de backlog de John (solo John)

- **Captura de tareas y pendientes**: John escribe o manda audio → transcripción → Claude estructura: título, tipo (asignación para alguien / pendiente propio), responsable (roster del plano 07) o cliente/proyecto (`client_id`/`initiative_id` de WP14/WP17), prioridad, fecha → el bot responde con la pieza formateada y botones `Confirmar / Editar / Descartar`. **Nada se crea sin confirmación** (evita asignaciones fantasma desde una reunión).
- **Gestión del backlog propio**: `/pendientes` (todo lo de John, agrupado por cliente/proyecto) · `/pendientes hogar-center` (filtrado) · "sube la prioridad de X" · "eso ya está, ciérralo" — el bot opera el backlog conversacionalmente, siempre sobre la DB de la dapp.
- **Los 3 focos del día**: cada mañana (hora en el genoma) el bot propone a John sus 3 prioridades del día según vencimientos, prioridad y bloqueos que lo esperan (`needs_founder`). John confirma o reordena respondiendo.
- **Notas de reunión**: `/nota` o audio largo → `notes (author, text, meeting_ref, created_at)` → resumen como respuesta. Si contiene tareas, el bot las propone una a una.
- **Consultas**: "¿cómo va el proyecto X?", "¿qué está bloqueado?" → respuesta desde los agregados del dashboard (WP15). Solo lectura.
- El bot habla SOLO con John en v1 (un solo `telegram_link` autorizado).

## Alcance v2 — El equipo (check-ins por Telegram, opcional y posterior)

El equipo hace su check-in diario en el tablero web (WP14). Extenderlo a Telegram (el bot escribe a cada miembro, recibe avances + evidencia a Blob Storage, hace seguimiento proactivo con máximo 1 mensaje/persona/día) queda especificado aquí como fase B, y se activa solo si el hábito web muestra fricción — decisión de John con datos de 2+ semanas de uso real.

## Guardrails

- El bot opera con las 5 herramientas y nada más: no paga, no cambia el genoma, no cierra épocas, no toca clientes/credenciales, no habla con personas fuera de `telegram_links`.
- Toda acción del bot queda en un log (`bot_actions`) visible en admin.
- Webhook con secret token de Telegram validado en cada request; el bot token vive en Key Vault/App Settings.
- Los audios y mensajes se procesan y NO se conservan crudos más allá de la nota/asignación resultante (minimización de datos).
- Si Claude clasifica con baja confianza → `no_entendido` → el bot pregunta, no adivina.

## NO-ALCANCE

- WhatsApp (evaluar después; el API de negocio tiene costo y fricción de aprobación).
- Que el equipo cree/asigne tareas por bot (v2, cuando el flujo de John esté maduro).
- Métricas de tiempo, ubicación, "última conexión" o cualquier telemetría de presencia — explícitamente prohibido, es control por horas.
- Bot en grupos (v1 es 1:1; los ritos grupales siguen en sus canales).
- Respuestas generativas libres: el bot conversa lo mínimo para ejecutar sus 5 herramientas.

## CRITERIOS DE ACEPTACIÓN (v1)

- [ ] Audio de John en reunión → asignación confirmada con responsable y fecha → visible en `/equipo/hoy` del asignado y en el dashboard (flujo completo).
- [ ] Pendiente por cliente ("pendiente con X: ...") queda clasificado con `client_id` correcto y aparece en el backlog del cliente (WP17).
- [ ] `/pendientes` y el filtro por cliente devuelven exactamente lo que muestra la web (misma fuente).
- [ ] Los 3 focos del día llegan a la hora del genoma y reordenar respondiendo funciona.
- [ ] Mensaje de un telegram_id no registrado: ignorado + log (test).
- [ ] Webhook rechaza requests sin el secret token (test).
- [ ] Grep de copys del bot: cero lenguaje de vigilancia o sobre personas.

OWNER — Fausto (webhook + integración) + David (flujos y copys) · Vale: audita copys · John: crea el bot con @BotFather, provee token + ANTHROPIC_API_KEY, y lo usa a diario (el mejor test).
TAMAÑO — M (v1 solo-John) · Estimado: 1,5–2 días. Depende: WP14 (modelo). WP15 recomendado antes (el bot consulta sus agregados). WP17 para clasificar por cliente.
