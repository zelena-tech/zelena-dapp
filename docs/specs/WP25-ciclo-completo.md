# WP25 · Ciclo de vida completo: cierre ritual, puente Ágora↔equipo y motivo de las aplicaciones

CONTEXTO — `state-machine.ts` tiene cinco estados (`Open → Assigned → Delivered →
Scored → Distributed`) y `Distributed` es terminal: el proyecto "termina" cuando
se paga, no cuando se muestra ni cuando se aprende de él. El puente con el equipo
**ya existe en el modelo**: `assignments.published_as_project_id` (WP14, "en v1
basta el enlace"), pero no hay lectura inversa (un bounty no muestra sus tareas)
ni forma de crear tareas desde el bounty. `applications` decide en silencio:
`approved | rejected` sin motivo, y el aplicante no tiene vista propia.

`Draft` (borrador del cliente) es alcance de **WP23** y no se duplica aquí.
`Disputed` es alcance de **WP29**. Este WP cierra el ciclo por el final y tiende
el puente que ya estaba medio construido.

PROBLEMA — El demo day y la retro están en los documentos (B2) pero un proyecto
puede cobrarse sin haberse mostrado nunca. El trabajo del bounty y las tareas del
equipo son la misma cosa en dos pantallas que no se ven. Quien aplicó y no fue
elegido no sabe por qué — y eso es exactamente la opacidad que el decision log
existe para evitar.

RESULTADO ESPERADO — Un proyecto solo llega a `Closed` con un rito de demo day
referenciado. El detalle del bounty muestra sus tareas y su avance. Cada
aplicación no elegida lleva un motivo que el aplicante puede leer.

ALCANCE
- **Máquina de estados**: `PROJECT_STATES` += `Closed`; acción `cerrar:
  Distributed → Closed` que exige `riteRef` (id del rito de WP26; mientras WP26
  no exista, un texto no vacío). `nextAction('Distributed') = 'cerrar'`. Función
  pura + test de tabla completo. Sin saltos.
- **Modelo (aditivo, vía `COLUMNAS_NUEVAS`)**: `projects.closed_rite_ref TEXT`,
  `projects.closed_at TEXT`, `applications.decision_reason TEXT`. Actualizar el
  comentario de `projects.state` en `schema.sql`.
- **Puente**: `listAssignmentsForProject(db, projectId)` sobre
  `published_as_project_id`; `createAssignment` acepta `publishedAsProjectId`;
  en `/agora/[id]` bloque "Tareas del bounty" con conteo, barra y estados (solo
  lectura para quien no es miembro del equipo).
- **Aplicaciones**: `rejectApplication(appId, reason)` exige motivo ≥ 10
  caracteres (mismo umbral que las mutaciones, WP08). `approveApplication` marca
  las demás `rejected` con motivo estándar *"se eligió otro perfil para este
  bounty"*. El motivo habla del bounty y del perfil, **nunca de la persona**.
- `StateBadge` y `nextAction` en UI para `Closed`. Flag `LIFECYCLE_V2_ENABLED`.

NO-ALCANCE — `Draft` (WP23). `Disputed` (WP29). Notificaciones. Cambiar la tabla
20/70/10 ni el cierre de período/merkle. Pantalla del aplicante (la pinta WP28;
aquí queda la API).

ARCHIVOS QUE TOCA — `lib/state-machine.ts`, `lib/admin.ts`, `lib/repo.ts`,
`lib/assignments.ts` (una función nueva), `lib/db.ts` (`COLUMNAS_NUEVAS`),
`app/agora/[id]/page.tsx`, `schema.sql` (comentario). **Comparte
`state-machine.ts` con WP23 y WP29 → secuencial con ellos, nunca en paralelo.**

CRITERIOS DE ACEPTACIÓN
- [ ] `transition('Distributed','cerrar')` devuelve `Closed`; `cerrar` desde
  cualquier otro estado lanza `InvalidTransitionError` (test de tabla).
- [ ] Cerrar sin `riteRef` → error; el rito queda en `closed_rite_ref` (test).
- [ ] Un bounty con 5 asignaciones enlazadas muestra "2 de 5 hechas" desde
  `published_as_project_id` (test de lectura).
- [ ] Rechazar sin motivo o con < 10 caracteres → error; aprobar una aplicación
  marca las otras `rejected` con motivo estándar (test).
- [ ] Regresión: proyectos existentes en `Distributed` siguen válidos; la suite
  previa pasa sin cambios; **cero `DELETE`/`UPDATE` destructivo — solo columnas
  nullable nuevas**.
- [ ] Copys revisados con la regla del doc 16: el motivo califica el ajuste al
  bounty, jamás a la persona.

OWNER — Fausto (máquina + modelo + API) · David (bloque en `/agora`) · Vale (valida
los tests de la máquina: es la función pura única).
TAMAÑO — S–M · Estimado: 1 día. Depende: WP14. Secuencial con WP23.
