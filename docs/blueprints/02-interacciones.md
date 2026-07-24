# Plano 02 · Interacciones (los 5 flujos que definen el producto)

## 1. Onboarding (la puerta)

```mermaid
sequenceDiagram
    participant M as Miembro existente
    participant N as Invitado
    participant D as Dapp
    participant P as Privy
    participant S as Stellar testnet

    M->>D: genera invitación (tope por tier)
    M->>N: envía código al correo
    N->>D: /entrar con código + email
    D->>P: login por email
    P-->>N: wallet Stellar embebida (invisible)
    D->>N: exige 2º correo de respaldo
    N->>D: firma CLA (hash SHA-256)
    D->>D: verifica firma ed25519 (WP01) + consume invitación atómica
    D->>S: encola anclaje del hash (worker)
    D-->>N: perfil creado — primera misión <2h sugerida
```

Regla de diseño: sin invitación no hay login; sin CLA no hay primer bounty; sin 2º correo no hay perfil (continuidad si sale de la org).

## 2. Ciclo de un bounty (el flywheel)

```mermaid
stateDiagram-v2
    [*] --> Open: publicado con etiqueta SAS/DAO + rúbrica + tabla de pagos
    Open --> Assigned: supervisor asigna (B8 aplica)
    Assigned --> Delivered: contribuidor entrega
    Delivered --> Scored: score + revisión cruzada (10%)
    Scored --> Distributed: puntos dentro del presupuesto de época
    Distributed --> [*]: reputación acumulada (append-only)
```

## 3. Cierre de época (la generación evolutiva)

```mermaid
sequenceDiagram
    participant A as Admin (founder)
    participant F as lib/fitness.ts
    participant G as Genoma
    participant DL as Decision log
    participant S as Stellar testnet

    A->>F: cierra época N
    F->>F: fitness = retención + calidad + ritos − disputas
    F-->>A: reporte explicable + recomendación keep/revert
    A->>DL: firma decisión (humano decide, siempre)
    A->>G: mutación época N+1 (≤2 genes, ±15%, anunciada)
    A->>S: merkle root del cierre anclado
```

## 4. Feedback nocturno (el loop con Claude Code)

```mermaid
sequenceDiagram
    participant J as John (mañana)
    participant L as localhost:3000
    participant FB as FEEDBACK.md
    participant CC as Claude Code (noche)
    participant Q as QUEUE.md

    CC->>Q: procesa WPs ready toda la noche (protocolo CLAUDE.md)
    CC->>CC: NIGHT-REPORT.md al terminar
    J->>L: revisa diseño y usabilidad
    J->>FB: escribe mejoras (- [ ] página: qué)
    CC->>FB: convierte cada ítem en FBxx
    CC->>Q: FBxx con prioridad sobre WPs
```

## 5. Nómina del core (Modo A+, tras gate legal)

Contrato PDF firmado → hash anclado en mainnet → pago USDC desde multisig SAS (fuera de la app) → admin registra tx en `/nomina` → la app verifica contra Horizon → el pagado ve contrato→hash→tx enlazados. Nadie más ve montos.
