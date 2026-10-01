# WP17 · Entornos por cliente (workspaces)

> **DESCONGELADO — decisión de John, 2026-08-16.** WP17 estaba marcado v1.1 a la
> espera de los criterios de USO de v1. John decide adelantarlo porque el
> conocimiento de cliente disperso es hoy el riesgo más caro de la operación.
> Consecuencia aceptada: v1 crece y WP13/14/15/16/19 se retrasan en proporción.
> El grafo de operación que lo acompaña es **WP20**.

CONTEXTO — Zelena opera ~10 clientes con instancias dedicadas del WMS más proyectos de Odoo y desarrollo a la medida. Hoy el contexto de cada cliente vive disperso: WhatsApp, correos, la cabeza de John. Decisión de alcance v1: **solo equipo interno accede** (el portal del cliente se evalúa después), y entran **backlog + marca**. Contratos y costos de nube quedan para v2.

PROBLEMA — Nadie puede responder rápido "qué hay pendiente con este cliente", "de qué color es su marca" o "quién tiene acceso a su servidor". El conocimiento del cliente no es un activo de la organización: es memoria individual.

RESULTADO ESPERADO — Cada cliente tiene un espacio donde el equipo asignado ve su backlog, su identidad visual y el inventario de accesos, con permisos según su participación en ese cliente.

## Alcance

### Modelo
- `clients`: `name, slug, status (activo|pausado|prospecto), industry, initiative_id, notes`.
- `client_members`: `client_id, user_id, access_level (lead|colaborador|lectura)` — **la participación define el permiso**. Quien no es miembro de un cliente no ve su espacio (ni en listados, ni por URL directa).
- `brand_assets`: `client_id, kind (logo|color|tipografía|guía), value (hex o texto), file_url, notes`.
- `credential_inventory`: `client_id, name, type (nube|servidor|api|db|otro), location (dónde vive el secreto: "Key Vault kv-zelena / secret azure-fms-prod", "1Password bóveda Clientes"), owner_user_id, rotated_at, expires_at, notes`. **Sin columna de secreto. Nunca.**

### Permisos (RBAC por cliente)
| Nivel | Puede |
|---|---|
| `lead` | Todo lo del cliente + gestionar miembros e inventario |
| `colaborador` | Ver todo + crear/mover asignaciones del cliente |
| `lectura` | Ver backlog y marca; **no** ve el inventario de credenciales |
| No miembro | Nada. El cliente no aparece ni existe para esa persona |

`founder` ve todo por definición. Cada acceso al inventario de credenciales queda registrado en un log de auditoría (`credential_access_log`: quién, qué, cuándo) — no porque la app tenga secretos, sino porque saber *dónde* está una credencial ya es información sensible.

### Vistas
- `/clientes` — solo los clientes donde soy miembro.
- `/clientes/[slug]` — pestañas: **Backlog** (asignaciones de WP14 filtradas por cliente) · **Marca** (paleta con muestras de color copiables, logos, guía) · **Accesos** (inventario; oculto para `lectura`) · **Equipo** (quién participa y con qué nivel).
- El selector de cliente filtra también `/equipo/hoy` y el dashboard de WP15.

### Integración con lo existente
- `assignments.client_id` (nullable — el trabajo interno no tiene cliente).
- Las iniciativas de WP14 (WMS, Odoo, DAO, Interno) se cruzan con clientes: un cliente puede tener trabajo de varias iniciativas.
- `assignments.graph_node_id` (nullable) enlaza una asignación con un nodo del grafo de WP20. Por referencia, jamás por copia.

## NO-ALCANCE (explícito)

- **Almacenar secretos.** La app guarda dónde vive la credencial, jamás su valor. Sin campo cifrado, sin "solo esta vez". Si algún día se integra Azure Key Vault, será por *referencia* con permisos de Azure resolviendo el acceso — el modelo actual ya lo soporta sin migración.
- Acceso de clientes o contratistas externos (v2, decisión aparte).
- Contratos y documentos (v2).
- Costos de nube y consumo (v2 — requiere Azure Cost Management o registro manual).
- Facturación, CRM, pipeline comercial.

## CRITERIOS DE ACEPTACIÓN

- [ ] Un usuario que no es miembro de un cliente recibe 404 (no 403) al pedir su URL directa — el cliente no debe ni revelarse (test).
- [ ] Nivel `lectura` no ve la pestaña de accesos ni sus datos vía API (test de API, no solo de UI).
- [x] Cero campos que almacenen secretos: verificado por `auditSchemaForSecretColumns()` en CI, con control negativo que comprueba que el auditor sí detecta una columna mala. Ya no depende de que alguien recuerde hacer grep.
- [x] Intentar guardar un secreto en cualquier campo del inventario se rechaza (test con token de Shopify, URL con contraseña y token de GitHub).
- [ ] Toda consulta al inventario queda en `credential_access_log`.
- [ ] Las asignaciones de un cliente aparecen en su backlog y en `/equipo/hoy` de sus miembros.
- [ ] Paleta de marca: click en un color lo copia al portapapeles.

OWNER — Fausto (modelo/RBAC) + David (UI) · Juan dueño del inventario de credenciales · AGENTE: modelo + RBAC + vistas + tests de permisos · HUMANO (John): define los clientes iniciales y quién participa en cada uno; Vale valida los tests de permisos (es la superficie crítica).
TAMAÑO — L · Estimado: 2 días. Depende: WP13 (roles), WP14 (asignaciones — la pestaña Backlog queda vacía hasta que exista).
