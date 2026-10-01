# WP21 · Multi-organización: la dapp como plataforma (v2)

**Estado: v2 — especificado, NO descongelado.** Este documento existe para que la
decisión esté lista el día que se tome, no para tomarla hoy.

CONTEXTO — Harmony nació de una observación: la infraestructura de incentivos
sirve para más proyectos que el WMS. De ahí nació la DAO. El siguiente paso
lógico es que **cualquier persona cree su organización** sobre la misma lógica de
contratos. Y la mitad on-chain YA existe: el Factory Contract fue diseñado para
esto (registro global de organizaciones, IDs autoincrementales, configuración por
empresa, instancia aislada sin mezcla de fondos). Lo que es mono-organización hoy
es la **dapp**: `users`, `periods`, `genome_versions` y `points_ledger` son
globales, sin `org_id`.

JUSTIFICACIÓN TÉCNICA (además de la comercial) — MODELO-001 §5 e H005 de
`zelena-ops/investigacion/`: con una sola organización, el sistema evolutivo es
una (1+1)-ES — hill-climbing con una muestra ruidosa de fitness por época. Con N
organizaciones se convierte en un **modelo de islas**: N genomas evolucionando en
paralelo contra entornos distintos, N muestras de fitness por generación, y
migración opcional de genes entre orgs. Sin población no hay evolución real.
El multi-org no es solo un producto: es el requisito matemático del sistema
autoadaptativo.

## Alcance (cuando se descongele)

### Modelo
- `orgs`: `slug, name, status, genome_lineage_root, created_by, parent_org_id`.
- `org_id` en: `users`(membresía vía tabla puente `org_members`), `periods`,
  `genome_versions`, `points_ledger`, `reputation_events`, `mutation_decisions`,
  `epoch_fitness`, `proposals`. Migración: todo lo existente pasa a
  `org_id = 1` (ZELENA).
- **Herencia de genoma (autorreproducción):** una org nueva nace con el genoma de
  su org madre — o del genoma v1 canónico — ± una mutación fundacional validada
  por las mismas reglas (≤2 genes, ±15%). El linaje queda en `parent_org_id` +
  decision_log. Esto implementa la generación de autorreproducción de la matriz
  self-* en el único punto donde ya hay infraestructura (Factory).
- **Migración de genes entre orgs:** opt-in, con consentimiento de la org
  receptora, registrada como mutación normal (justificación: "adoptado de org X,
  época Y"). Nunca automática (No Free Lunch: un genoma bueno en una bodega puede
  ser malo en una consultora).

### Aislamiento (la propiedad que no se negocia)
Modelo de actores: cada org es un actor con estado aislado. Ninguna consulta
cruza `org_id` sin rol de plataforma. El RBAC de WP17 se reusa: la membresía
define el permiso, un no-miembro recibe 404. Los fondos jamás se mezclan (ya
garantizado on-chain por el Factory; la dapp debe igualarlo en datos).

### Flujo de creación (v2 conservador)
Detrás de invitación al inicio — NO self-serve público. Crear org exige: wallet
con CLA firmado, genoma fundacional válido, y aceptación de que los puntos son
intransferibles y sin valor monetario (mismas reglas de Génesis).

## NO-ALCANCE (explícito y duro)

- **Custodia del dinero del cliente dentro de la app.** Retener fondos de un
  tercero antes de la entrega es custodia de recursos ajenos y entra por los
  gates del plano 04 (Escrow de Milestones, Modo B): auditoría independiente +
  anchor comercial + clasificación legal.

  > **Corrección (2026-08-17).** Una versión anterior de este documento decía que
  > "fondear proyectos" era captación masiva de dineros del público (Art. 316 CP).
  > **Eso era una lectura equivocada del caso de uso.** Un empresario que paga por
  > un desarrollo que necesita celebra un contrato de prestación de servicios: la
  > SAS factura, entrega y cobra. No hay promesa de rendimiento ni intermediación
  > de recursos ajenos, y por lo tanto no hay captación. Ver **WP23**, que no tiene
  > gate regulatorio. La captación aparecería solo si ZELENA recibiera dinero del
  > público ofreciendo un retorno — algo que no está en ningún roadmap.
- Emisión de tokens por org. ZWORK sigue siendo interno e intransferible.
- Portal self-serve público (v3, tras pilotos invitados).
- Cambiar el motor evolutivo: el mismo `mutation.ts`/`fitness.ts` sirve por org.

## GATES DE ENTRADA (los tres, no dos de tres)

1. v1 "Organizar" cumple sus 4 criterios de USO.
2. **≥3 épocas internas cerradas** con fitness calculado y decisión de mutación
   firmada (el piloto manual que exige la auditoría de producto).
3. H001 con primera estimación de σ_ε (si el fitness es puro ruido, multiplicar
   orgs multiplica ruido).

## CRITERIOS DE ACEPTACIÓN (borrador)

- [ ] Una wallet miembro de la org A no puede leer NADA de la org B (test de
  datos, no de UI — mismo patrón 404 de WP17).
- [ ] Crear una org hija hereda el genoma de la madre ± una mutación válida, con
  linaje en decision_log (test).
- [ ] Los datos existentes migran a org_id=1 sin pérdida (test de conteos antes/después).
- [ ] Cierre de época, fitness y mutación operan por org, sin interferencia (test
  con 2 orgs cerrando épocas distintas el mismo día).
- [ ] El importador del grafo (WP20) y los clientes (WP17) quedan scoped por org.

OWNER — Fausto (modelo/migración) · John (decisión de gates) · Vale (valida gates)
TAMAÑO — XL · Depende: v1 completo + 3 épocas + H001. Referencias:
`investigacion/modelos/MODELO-001` §5, `investigacion/hipotesis/H005`.
