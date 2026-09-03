# WP20 · Grafo de operación del cliente

CONTEXTO — WP17 le da a cada cliente un espacio con backlog, marca e inventario de accesos. Falta lo más caro de reconstruir: **cómo opera realmente el cliente.** Sus procesos, las variantes de cada proceso (facturación a crédito, pronto pago, retención, exento de IVA), qué módulos de Odoo se le desarrollaron, quién es el único que entiende cada pieza. Hoy eso vive en la cabeza de John y en la de proveedores externos.

PROBLEMA — Cuando un proveedor externo se va o se pelea con nosotros, Zelena queda sin capacidad de operar la cuenta: no puede explicarle al cliente cómo funciona su propio sistema, ni estimar un cambio, ni defenderse. El conocimiento del cliente no es un activo de la organización.

RESULTADO ESPERADO — Cualquier miembro del equipo abre `/clientes/[slug]` y responde, sin preguntarle a nadie: qué procesos tiene el cliente, qué variantes, qué se rompe si tumbamos un módulo, cuánto de eso está verificado contra el sistema y cuánto es suposición.

## Decisión de arquitectura: la dapp NO es dueña del grafo

**El grafo vive en `zelena-ops`, un repositorio PRIVADO de la organización.** Un nodo = un archivo markdown con frontmatter YAML, versionado en git, revisado por PR y editable en Obsidian.

Estas tablas son una **proyección de solo lectura** (read model) que se reconstruye de forma idempotente. La dapp nunca escribe de vuelta al grafo.

Por qué así y no filas de SQL como fuente de verdad:

| Necesidad | Git + markdown | Filas de SQL |
|---|---|---|
| Historia de por qué cambió un proceso | `git log`, `git blame` | columna `updated_at` |
| Revisión antes de publicar | Pull request | ninguna |
| Diff legible de un cambio de proceso | nativo | imposible |
| Que los agentes lo lean y escriban | formato nativo | requiere API |
| Edición cómoda, también en móvil | Obsidian | formulario web |

Cumple además la regla anti-fragmentación del plano 07: **una pieza de trabajo vive en UN solo lugar.** El conocimiento vive en zelena-ops; la dapp lo muestra y lo enlaza.

> **REGLA DE SEGURIDAD (crítica).** `zelena-ops` es y seguirá siendo **privado**. Contiene procesos, estructura contable y el mapa de dónde viven las credenciales de clientes reales. Jamás se mezcla con el repositorio público de la dapp (WP06). Un CI del repo público falla si detecta rutas de `clientes/`.

## Alcance

### Modelo (proyección)
- `graph_nodes`: `client_id, node_id, kind, name, state, confidence, criticality, bus_factor, owner_zelena, owner_client, source, verified_at, tags, source_path` + los tres niveles de explicación (`what_is`, `how_it_works`, `tech_detail`), `business_rules`, `open_questions`, `open_count`. Único por `(client_id, node_id)`.
- `graph_edges`: `client_id, from_node, to_node, kind`. Aristas tipadas: `pertenece_a`, `varia_de`, `depende_de`, `implementado_en`, `ejecutado_por`, `usa_credencial`, `bloquea`, `documentado_en`, `reemplaza`, `sincroniza_con`.
- `graph_imports`: historial de importaciones con `pct_verified`, `open_questions`, `bus_factor_critical`. Permite mostrar la **evolución de la cobertura** en el tiempo.

### Los tres campos que hacen que esto sirva

**`confidence`** — `verificado` (comprobado contra la BD o el código) · `declarado` (nos lo dijeron) · `inferido` (lo dedujo un agente) · `sospechoso` (hay evidencia contradictoria).

Esto es lo que convierte el grafo en algo confiable: no es que sepamos todo, es que **sabemos exactamente qué sabemos y qué no**, y podemos cerrarlo por orden de riesgo. La UI marca visualmente cualquier nodo no verificado.

**`bus_factor`** — cuántas personas entienden la pieza. `0` o `1` con criticidad alta es riesgo activo, no una nota al pie. Genera el mapa de exposición de la cuenta.

**`open_count`** — preguntas abiertas del nodo. La suma es el plan de trabajo del descubrimiento y una métrica de avance honesta.

### Importador
- `POST /api/clientes/grafo` con `{ slug, grafo }`. Solo `founder`.
- **Idempotente**: correrlo dos veces con el mismo JSON deja el mismo estado. Los nodos que desaparecieron del origen se borran de la proyección.
- **Escaneo de secretos antes de escribir nada**: si algún cuerpo trae un patrón de secreto, la importación se aborta completa. zelena-ops ya lo valida en pre-commit; esto es defensa en profundidad porque el destino (Azure SQL) es un blast radius distinto.
- **Vocabulario cerrado**: un `kind` o `confidence` desconocido es un error, no algo que se guarde en silencio.

### Vistas
- Pestaña **Operación** en `/clientes/[slug]`: nodos agrupados por tipo, con su confianza visible.
- Detalle de nodo: los tres niveles de explicación, sus vecinos con el tipo de arista, y la ruta del archivo en zelena-ops.
- **Mapa de exposición**: de quién depende cada pieza crítica.
- **Evolución de la cobertura**: la gráfica que justifica el retainer.

### Puente con el trabajo
- `assignments.graph_node_id` (nullable): una asignación puede apuntar a un nodo. Por referencia, jamás por copia. Ejemplo real: *"Verificar la variante de retención contra el sistema"* → al cerrarse, ese nodo pasa de `inferido` a `verificado`.

## NO-ALCANCE (explícito)

- **Editar el grafo desde la dapp.** Es de solo lectura. Editar = PR en zelena-ops. Si esto se relaja, se pierden historia y revisión, y aparece drift entre dos fuentes.
- **Acceso de clientes externos.** Decisión aparte (ver nota de portal en QUEUE).
- Visualización de grafo interactiva dentro de la dapp — ya existe `grafo.html` generado por `construir_grafo.py`; duplicarla aquí no aporta en v1.
- Sincronización automática desde git. En v1 la importación es explícita y manual.
- Almacenar secretos. Nunca, en ninguna tabla.

## CRITERIOS DE ACEPTACIÓN

- [x] Importar dos veces el mismo `grafo.json` deja exactamente el mismo estado (test de idempotencia).
- [x] Un nodo que desaparece del origen se borra de la proyección (test).
- [x] Un nodo con un secreto en el cuerpo **aborta la importación completa** y no escribe nada (test).
- [x] Un `kind` desconocido se rechaza en vez de guardarse (test).
- [x] Las aristas que apuntan a nodos inexistentes se descartan (test).
- [x] Un no-miembro del cliente no puede leer el grafo por API (test, no solo UI).
- [x] `impactOf()` responde "¿qué se rompe si tumbamos esto?" recorriendo transitivamente (test sobre el grafo real de Montoc).
- [x] La cobertura calcula `pct_verified`, preguntas abiertas y bus factor ≤1 (test).
- [ ] La pestaña Operación muestra los nodos con su confianza y enlaza al detalle (validación humana en localhost).

OWNER — Fausto (modelo + importador) · David (pestaña Operación) · AGENTE: modelo, importador, consultas y tests · HUMANO (John): decide qué clientes tienen grafo y quién participa; Vale valida los criterios.
TAMAÑO — M · Depende: WP17 (clients y RBAC), WP14 (para el enganche `graph_node_id`).
