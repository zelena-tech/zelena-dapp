# Plano 01 · Arquitectura (estado actual → objetivo v1.1)

El estado actual detallado está en `docs/architecture.md`. Este plano muestra el sistema completo y qué añade v1.1 (líneas punteadas = nuevo).

```mermaid
graph TB
    subgraph Cliente["Navegador (contribuidor / core team)"]
        UI["Next.js UI<br/>entrar · agora · academia · perfil · gobernanza · admin"]
        PRIVY["Privy SDK<br/>email + wallet Stellar embebida"]:::nuevo
    end

    subgraph Servidor["apps/web (Next.js API routes)"]
        API["API routes<br/>onboard · cla · invite · apply · academia · governance · admin"]
        LIBS["lib/: state-machine · rules · invites · cla · crypto · repo · session"]
        GENOME["lib/genome.ts<br/>parámetros versionados"]:::nuevo
        FITNESS["lib/fitness.ts<br/>motor de épocas"]:::nuevo
        NOMINA["api/nomina<br/>registro pagos USDC"]:::nuevo
    end

    subgraph Datos["Base de datos (SQLite en local → Azure SQL en producción)"]
        DB[("users · invites · cla_signatures · projects · milestones<br/>reputation_events · points_ledger · periods · decision_log<br/>proposals · votes · academia_*")]
        DBNEW[("genome_versions · epoch_fitness<br/>latent_audits · payroll_payments · user_emails")]:::nuevo
    end

    subgraph Stellar["Red Stellar"]
        TESTNET["Testnet: anclaje manageData<br/>(CLA hashes · merkle roots por época)"]
        MAINNET["Mainnet: anclaje de contratos del core<br/>+ pagos USDC multisig SAS (Modo A+)"]:::nuevo
        WORKER["anchor-worker.mjs<br/>cola anchor_queue"]
    end

    SIM["packages/scripts/sim<br/>simulador ABM"]:::nuevo

    UI --> API
    PRIVY -.-> API
    API --> LIBS
    LIBS --> DB
    GENOME --> DBNEW
    FITNESS --> DBNEW
    NOMINA --> DBNEW
    LIBS --> WORKER
    WORKER --> TESTNET
    NOMINA -.verifica tx.-> MAINNET
    SIM -.importa reglas puras.-> LIBS

    classDef nuevo stroke-dasharray: 5 5
```

## Principios que no se negocian

1. **Toda la DB detrás de `lib/db.ts`** (swap de motor sin tocar lógica). Hoy: SQLite en local, **Azure SQL** en producción (driver `mssql`, autenticación por managed identity). Este principio es lo que hizo que cambiar de motor costara minutos y no un refactor.
2. **Funciones puras para las reglas** (`state-machine`, `rules`, `fitness`, `genome`): testeables y reutilizables por el simulador.
3. **Append-only donde importa**: reputación, puntos, genoma, decision log — los saldos se derivan, nunca se mutan.
4. **La app no custodia fondos.** Los pagos se ejecutan fuera (multisig SAS) y la app registra + verifica contra Horizon. La custodia on-chain llega con el escrow de M2, auditado.
5. **Anclaje ≠ contrato**: en M1 la integridad se prueba con `manageData` (barato, seguro); los contratos Soroban entran en M2 (ver plano 04).
