# WP15 · Dashboard de seguimiento (la vista de John)

CONTEXTO — El playbook define la semana de John: 60% clientes y aprendizaje, 30% specs y reviews, 10% reuniones. Para eso necesita ver el estado real sin reuniones de reporte.

PROBLEMA — Hoy el estado del trabajo se obtiene preguntando. Eso convierte a John en el cuello de botella y consume el tiempo que debería ir a clientes.

RESULTADO ESPERADO — Una pantalla que responde en 30 segundos: qué avanza, qué está bloqueado y quién necesita algo de mí.

ALCANCE
- **`/equipo/dashboard`** (founder y supervisor):
  - Por iniciativa: abiertas / en curso / en revisión / bloqueadas / cerradas en la época.
  - **Bloqueos primero**: lista de todo lo bloqueado con motivo, responsable y días bloqueado — es la sección superior, porque es lo único que requiere acción de John.
  - **Esperando a John**: asignaciones marcadas `needs_founder` (decisión, visual, inversión) — su bandeja de gates, del playbook.
  - Carga por persona: abiertas y en curso por miembro (para detectar sobrecarga, no para rankear personas).
  - Salud de ritos: % de check-ins de la semana (componente del fitness, WP07).
- **Digest diario** (texto, generado server-side al cierre del día): hecho / en curso / bloqueado consolidado del equipo. Visible en el dashboard y exportable en texto plano para pegarlo donde sea. En v1 **no se envía por correo** — eso es la fase automatizar.
- **Métricas de época** en el mismo lugar: reusar `epoch_fitness` (WP07) para que el seguimiento operativo y el motor evolutivo se lean juntos.
- Todo con datos reales de WP14: cero métricas inventadas o mock.

NO-ALCANCE — Envío automático por correo/Teams (automatizar). Gráficas complejas (una barra de estados por iniciativa basta). Predicciones. Exportes PDF.

CRITERIOS DE ACEPTACIÓN
- [ ] El dashboard carga con datos reales y responde las 3 preguntas (avanza / bloqueado / me necesita) sin scroll adicional.
- [ ] Un bloqueo creado en `/equipo/hoy` aparece en el dashboard en el siguiente render.
- [ ] Digest del día refleja exactamente los check-ins y cambios de estado de ese día (test con datos sembrados).
- [ ] Solo founder/supervisor acceden; un `core` normal recibe 403 (test).

OWNER — Dev 2 · AGENTE: vistas + agregaciones + tests · HUMANO (John): usa el dashboard 3 días y escribe mejoras en FEEDBACK.md.
TAMAÑO — M · Estimado: 1 día. Depende: WP14.
