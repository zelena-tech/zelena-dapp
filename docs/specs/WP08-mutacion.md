# WP08 · Mutación por época

CONTEXTO — Doc 16 salvaguarda 4 (Houchin & MacLean): la organización tiende a congelar reglas; la variación se fuerza programadamente. Cada época DEBE proponer al menos una mutación.

RESULTADO ESPERADO — Desde el admin, el founder propone una mutación (1–2 genes, ±10–15%), se anuncia a la cohorte ANTES de que empiece la época, se aplica como nueva versión del genoma y es reversible en un click.

ALCANCE
- Admin: formulario "proponer mutación" — seleccionar gen(es) del genoma activo, nuevo valor (validación: máx 2 genes, cambio ≤15% para numéricos), justificación obligatoria.
- Al proponer: entrada automática en decision log + banner de anuncio visible para la cohorte ("La época N usará X=Y; antes X=Z; por qué").
- Al iniciar la época N: la versión mutada se vuelve activa (`effective_from_epoch=N`, mecanismo de WP02). Nunca a mitad de época; nunca retroactivo.
- "Revertir": crea versión nueva con los valores previos (append-only; el linaje nunca se borra), efectiva desde la época siguiente.
- Guard: no se puede cerrar una época sin haber decidido la mutación de la siguiente (aunque la decisión sea "sin cambios", que también se registra — la excepción es explícita, no silenciosa).

NO-ALCANCE — Mutación automática sin humano. Crossover entre células (no hay 2ª célula aún). Cambios al CLA o parámetros legales.

CRITERIOS DE ACEPTACIÓN
- [ ] Mutación propuesta → anunciada → activa en la época siguiente → revertible; todo visible en decision log.
- [ ] Validaciones: >2 genes o >15% rechazado; mutación a mitad de época imposible (test).
- [ ] El historial de versiones del genoma reconstruye el linaje completo (query de auditoría).

OWNER — Dev 1 · TAMAÑO — M · Estimado: 1 día. Depende: WP07.
