# Zelena Dapp

Aplicación de navegador (Dapp) del ecosistema **Zelena DAO**, sobre **Stellar / Soroban**.
Las personas interactúan desde el navegador conectando su wallet: ven proyectos, aplican,
acumulan reputación y participan en la gobernanza. Sin fricción cripto.

## Arquitectura (dos capas)

- **Zelena**: marca, clientes y responsabilidad frente a ellos.
- **La comunidad**: reputación y ZWORK.

Detalle en `docs/architecture.md`.

## Monorepo

```
apps/web            Dapp en Next.js (App Router)
packages/contracts  Contratos Soroban (Rust): token (ZWORK) y treasury
packages/scripts    Utilidades (firma on-chain de documentos, despliegues)
docs                Documentación y decisiones de arquitectura
```

## Requisitos

- Node 20+ y pnpm (o npm)
- Rust + target `wasm32-unknown-unknown` y `stellar-cli` (para los contratos)
- Wallet **Freighter** en el navegador

## Quickstart

```bash
# Web (Dapp)
cd apps/web && npm install && npm run dev      # http://localhost:3000

# Contratos (Soroban, testnet)
cd packages/contracts/token
cargo build --target wasm32-unknown-unknown --release
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/zwork_token.wasm --network testnet
```

## Propiedad intelectual (importante)

Este repositorio es **propietario**. Toda contribución requiere **firmar el CLA**
**antes** del primer aporte: se ceden los derechos patrimoniales a Zelena (ver `CLA.md`).
Ver `CONTRIBUTING.md`. Sin CLA firmado, los PRs no se fusionan.

## Estado

Desarrollo temprano. Todo corre en **testnet**; mainnet está fuera de alcance hasta
auditoría, acuerdo de anchor y clasificación legal de pagos.
