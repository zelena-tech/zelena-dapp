# Plano 03 · Evolución (el sistema como organismo)

Fundamento completo: doc 16. Este plano es el mapa operativo.

## El bucle evolutivo

```mermaid
graph LR
    V["VARIACIÓN<br/>Ágora: bounties + propuestas<br/>Mutación del genoma por época"] --> S["SELECCIÓN<br/>Scoring + revisión cruzada<br/>Fitness multiobjetivo al cierre"]
    S --> R["RETENCIÓN<br/>Reputación append-only<br/>Genoma versionado · repo open source"]
    R --> V
```

## El genoma (qué muta y qué jamás)

| Muta (vive en genome_versions) | JAMÁS muta |
|---|---|
| Presupuesto de época, caps y rendimientos de Academia | El CLA y todo lo legal |
| Topes de invitación por tier | Historial: reputación, puntos, decision log |
| Pesos del fitness (meta-parámetros) | Épocas cerradas (nada retroactivo) |
| Split de pagos, umbrales de tiers (cuando entren) | La regla "entregas, no personas" |
| Cadencia de ritos, tamaño de primera misión | El derecho a portar tu identidad y progreso |

## Reglas del motor

1. Cada época = una generación; mínimo una decisión de mutación (incluso "sin cambios", explícita).
2. Mutación: ≤2 genes, ±15%, anunciada antes de la época, reversible (append-only).
3. Selección: fitness explicable → recomendación → **el humano firma** (Dietvorst).
4. Mutaciones grandes pasan primero por el simulador ABM (`packages/scripts/sim`).
5. Trimestral: auditoría de funciones latentes (Merton) → disfunciones → propuestas de mutación.

## Horizonte evolutivo (stages del Plan Maestro, en clave de sistema)

```mermaid
graph LR
    S0["Stage 0<br/>Founder decide<br/>genoma manual"] --> S1["Stage 1-2<br/>Cohorte vota ratificaciones<br/>mutaciones propuestas por guardianes"]
    S1 --> S3["Stage 3<br/>Multisig guardianes<br/>crossover entre células (CO/MX)"]
    S3 --> S4["Stage 4 · Autopoiesis<br/>la comunidad produce sus propios<br/>componentes: propuestas, guardianes, reglas"]
```

Criterio de madurez (doc 16): el sistema está vivo cuando produce sus propios componentes sin el founder. La descentralización es la recompensa de la madurez, no el punto de partida.
