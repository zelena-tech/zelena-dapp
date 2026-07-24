# WP12 · Auditoría de funciones latentes

CONTEXTO — Doc 16 salvaguarda 1 (Merton): toda mecánica produce consecuencias no buscadas; se auditan trimestralmente preguntando "¿qué produce esto que no buscábamos?" y "¿funcional para quién?". La disfunción detectada entra como propuesta de mutación (WP08).

RESULTADO ESPERADO — Sección en `/gobernanza` con el registro de auditorías por mecánica, y la plantilla que las estructura.

ALCANCE
- Tabla `latent_audits`: `mechanism (invitaciones|academia|rankings|scoring|ritos|...), period, manifest_function, latent_observed, functional_for, dysfunctional_for, action (none|mutation_proposed|mechanism_change), decision_log_id`.
- Página en `/gobernanza`: registro público de auditorías (transparencia = legitimidad weberiana).
- Formulario admin con la plantilla: función manifiesta → qué observamos que no buscábamos → ¿funcional para quién / disfuncional para quién? → acción.
- Si acción = `mutation_proposed`: link directo al flujo de WP08.

NO-ALCANCE — Automatizar la detección (es juicio humano). Frecuencia distinta a trimestral (por ahora).

CRITERIOS DE ACEPTACIÓN
- [ ] Auditoría creada por admin es visible públicamente en gobernanza.
- [ ] Auditoría con mutación propuesta enlaza a la propuesta en el decision log.
- [ ] Primera auditoría real registrada al cierre de la época 3 (criterio operativo, no de código).

OWNER — John + QA (el juicio) · Dev 2 (la página) · TAMAÑO — S · Estimado: medio día. Depende: WP09.
