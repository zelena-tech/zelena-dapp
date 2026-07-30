# WP14 · Módulo equipo: proyectos, asignaciones y seguimiento

CONTEXTO — Fase "organizar". El trabajo real del equipo (WMS, Odoo, DAO, soporte) vive hoy en un CSV y en la cabeza de John. Este módulo lo pone en la dapp reusando lo ya construido: máquina de estados, épocas, scoring, reputación, decision log.

PROBLEMA — Nadie sabe con certeza qué le toca hoy, en qué va cada proyecto, ni qué está bloqueado. John es el cuello de botella de la información.

RESULTADO ESPERADO — Cada persona abre la app y ve sus asignaciones del día; cada proyecto tiene estado y avance visibles sin preguntarle a nadie.

ALCANCE
- **Modelo**: `initiatives` (WMS · Odoo · DAO · Interno · Cliente-X, con horizonte Ahora/Siguiente/Parqueado) y `assignments` (`title, description, initiative_id, owner_id, status, priority, size, due_date, acceptance_criteria, spec_url, blocked_reason, created_by`). Reusar el patrón de `state-machine.ts`: `Backlog → Asignada → En curso → En revisión → Hecha`, con rama `Bloqueada` (y motivo obligatorio). Sin saltos.
- **Importador**: leer el CSV existente (`Zelena_Tareas_Import.csv` y `Zelena_Tareas_Dapp_v11_Import.csv`) → seed inicial. Columnas ya compatibles (Task Name, Description, Status, Priority, Assignee, Iniciativa, Horizonte, Criterio de aceptación).
- **Vista `/equipo/hoy`** (la pantalla que abre cada persona): "Tus asignaciones de hoy" ordenadas por prioridad y vencimiento; acciones de un click (empezar / a revisión / bloquear con motivo); bloque "Tu progreso" (regla de WP09: comparación consigo mismo, no solo con otros).
- **Vista `/equipo/proyectos`**: por iniciativa — asignaciones abiertas, bloqueadas, cerradas esta semana, responsable. Filtro por horizonte.
- **Check-in diario async** (rito 1 del playbook): 3 campos (hecho / haciendo / bloqueado) por persona, un registro por día. Alimenta el digest de WP15 y el componente "participación en ritos" del fitness (WP07).
- **Puente con el Ágora**: una asignación puede publicarse como bounty (misma pieza de trabajo, dos vistas). En v1 basta el enlace: `assignments.published_as_project_id`.

NO-ALCANCE — Gantt, time tracking, dependencias entre tareas, notificaciones por correo (fase automatizar), app móvil. Sin sprints: el ritmo lo da la época.

CRITERIOS DE ACEPTACIÓN
- [ ] Importar el CSV crea iniciativas y asignaciones con responsable y criterio de aceptación.
- [ ] Cada miembro ve SOLO sus asignaciones en `/equipo/hoy`; founder y supervisor ven todo.
- [ ] Cambio de estado inválido rechazado por la máquina de estados (test de tabla).
- [ ] Bloquear exige motivo; el bloqueo aparece en la vista de proyectos y en el digest.
- [ ] Check-in diario: uno por persona por día, editable el mismo día.
- [ ] Copys auditados con la regla del doc 16: se califican entregas, nunca personas.

OWNER — Dev 2 · AGENTE: modelo + vistas + importador + tests · HUMANO: valida que refleje el trabajo real del equipo.
TAMAÑO — L · Estimado: 1,5–2 días. Depende: WP13 (roles), WP00.
