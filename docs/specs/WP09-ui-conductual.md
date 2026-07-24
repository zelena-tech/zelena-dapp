# WP09 · Reglas conductuales de UI

CONTEXTO — Doc 16 §4: la especificación conductual del sistema. Tres reglas auditables en la UI actual.

RESULTADO ESPERADO — La UI cumple: (1) todo ranking muestra progreso propio al lado, (2) se califican entregas, nunca personas, (3) ningún flujo confisca puntos ganados — probado, no asumido.

ALCANCE
- **Rankings** (`/perfil`, vistas de época): junto a cualquier lista comparativa, bloque "tu progreso": delta propio vs época anterior (puntos, entregas, eje que más creció). La comparación consigo mismo tiene el mismo peso visual que el ranking.
- **Auditoría de copys**: barrido de todos los textos de UI y estados — reemplazar cualquier etiqueta sobre personas por etiquetas sobre entregas ("hito no aprobado", "entrega en revisión"; prohibido "bajo desempeño", "inactivo", "mal contribuidor"). Lista de reemplazos en el PR.
- **Test anti-confiscación**: test de integración que recorre todos los flujos que escriben en `points_ledger` y verifica que ninguno produce débitos de puntos ya otorgados (el ledger es append-only de créditos; débito = solo error administrativo explícito del founder con entrada en decision log, si es que existe — si no existe, mejor).
- Empty states de Academia/Ágora revisados con lente Bandura: el estado vacío siempre sugiere la siguiente acción alcanzable (<2h).

NO-ALCANCE — Rediseño visual. Nuevas mecánicas de gamificación. Cambios al scoring.

CRITERIOS DE ACEPTACIÓN
- [ ] Ningún ranking sin bloque de progreso propio (checklist QA por página).
- [ ] Cero etiquetas sobre personas en la UI (grep de términos prohibidos en el PR + revisión QA).
- [ ] Test anti-confiscación en la suite, verde.

OWNER — Dev 2 + QA (firma el checklist) · TAMAÑO — M · Estimado: medio día-1 día.
