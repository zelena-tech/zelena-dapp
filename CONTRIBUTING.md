# Cómo contribuir

Gracias por aportar a Zelena. Para proteger a la comunidad y la propiedad intelectual,
seguimos un proceso simple pero estricto.

## 1. Firma el CLA (obligatorio, antes de tu primer PR)

Lee y firma el **Acuerdo de Contribuidor** (`CLA.md`). Al firmarlo cedes a Zelena SAS los
derechos patrimoniales sobre tus contribuciones (tus derechos morales se respetan).
- Firma comentando en tu primer PR: `Acepto el CLA de Zelena (v1).`
- O firma on-chain anclando el hash del CLA con tu wallet (ver `packages/scripts`).

Un PR sin CLA firmado **no se fusiona** (lo verifica el CLA-check).

## 2. Flujo de trabajo

1. Crea una rama desde `main`: `feat/...`, `fix/...`, `docs/...`.
2. Commits **firmados** (GPG o SSH): `git commit -S -m "..."`.
3. Abre un PR. Debe pasar CI (lint + build + tests) y revisión de un CODEOWNER.
4. `main` está protegida: nada entra sin revisión + CI verde.

## 3. Estilo

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`...).
- TypeScript estricto en `apps/web`; `cargo fmt` + `clippy` en `packages/contracts`.
- No subir secretos. Usa `.env.local` (ignorado por git).

## 4. Reputación

Cada contribución aceptada alimenta tu perfil de reputación on-chain del DAO.
Más track record = acceso a proyectos más grandes.
