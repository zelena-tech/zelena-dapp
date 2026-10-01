# WP30 · Integridad del anclaje: especificación del merkle, claves sin colisión, CLA v2 retro-compatible y firma multisig

CONTEXTO — Revisión del anclaje contra la documentación oficial de Stellar y el
plano 04. Confirmado: `manageData` admite nombre y valor de hasta 64 bytes, así que
un SHA-256 en hex cabe justo. Hallazgos en el código actual:

1. **Una sola llave firma todos los anclajes**, incluido el merkle root de cada
   época (`SERVICE_ACCOUNT_SECRET` o una llave autogenerada en archivo). El plano
   04 lo marca como prerrequisito de M2: *"quién firma el root = multisig, no una
   llave"*. Quien tenga ese secreto ancla roots falsos.
2. **`data_key.slice(0, 64)` trunca en silencio.** Dos claves largas distintas
   colisionan y `manageData` con el mismo nombre **sobrescribe** el valor: un
   anclaje viejo puede quedar reemplazado on-chain sin que nadie lo note.
3. **El payload del CLA** es `zelena-cla-testnet-v1:<hash>`: el domain separator
   protege entre redes, pero no incluye wallet, versión ni fecha. Soroban usa
   `nonce + signatureExpirationLedger` para lo mismo. Hoy solo la unicidad de
   `cla_signatures` por wallet evita reusar una firma capturada.
4. **El merkle no está especificado por escrito** y hashea *strings hex*
   concatenados, no bytes. El Performance Verifier de M2 (plano 04) tendría que
   reproducir exactamente eso; un tercero no puede verificar sin la spec.
5. El worker reintenta sin tope ni backoff y no tiene estado terminal `failed`.

PROBLEMA — La prueba de integridad —el argumento central de "reputación
verificable"— depende de un secreto único, de claves que pueden colisionar y de
un algoritmo que solo existe en el código.

RESULTADO ESPERADO — Anclaje sin colisiones, merkle especificado y reproducible
por terceros, CLA v2 sin invalidar lo ya anclado, y una cuenta de anclaje
multisig en testnet. **Nada retroactivo**: lo anclado sigue verificando.

ALCANCE
- **Especificación del merkle** como anexo del plano 04: hojas = sha256 de los
  bytes UTF-8 del JSON canónico; pares ordenados por bytes; nodo = sha256(bytes(a)
  ‖ bytes(b)); hoja impar duplicada. `merkleRootV2` en `crypto.ts` con fixture de
  tres vectores de prueba. `merkleRoot` v1 se conserva para períodos ya anclados:
  `periods.merkle_version` nullable (default 1, vía `COLUMNAS_NUEVAS`).
- **Claves de anclaje**: `anchorKey(kind, ref) = kind + ':' + sha256Hex(ref).slice(0, 40)`
  — longitud garantizada ≤ 64 bytes, sin colisión práctica. Assert explícito;
  si algo excede 64 bytes → error, **nunca truncar**. El worker deja de hacer
  `slice`.
- **CLA v2**: `CLA_DOMAIN_SEPARATOR_V2 = 'zelena-cla-testnet-v2'`; payload =
  `sep:claVersion:wallet:claHash:YYYY-MM-DD`. `cla_signatures.payload_version`
  nullable (default 1). La verificación acepta v1 **solo** para filas existentes;
  toda firma nueva es v2. Cliente (`/entrar`) y servidor construyen el payload
  desde `cla-signing.ts`, que sigue siendo puro.
- **Worker**: backoff exponencial (15 s · 2^intentos, tope 1 h), `status='failed'`
  tras 8 intentos, rama `kind='rite'` (WP26).
- **Multisig — subtarea `needs_human`**: cuenta de anclaje con dos firmantes (John
  + servicio) y umbral medio = 2 para `manageData`; el worker construye la
  transacción y la deja en `pending_signature`; John firma con Stellar Lab o la
  CLI (procedimiento en `deploy.md`). Mientras no exista: llave de roots separada
  de la de CLA (`ROOT_ACCOUNT_SECRET`), rotación documentada.

NO-ALCANCE — Contratos Soroban (M2). Mainnet. Cambiar el hash canónico del CLA.
Re-anclar lo ya anclado. Passkeys / SEP-30 (WP04, M2).

ARCHIVOS QUE TOCA — `lib/crypto.ts`, `lib/cla-signing.ts`, `lib/onboard.ts`
(verificación), `app/entrar/page.tsx` (payload), `packages/scripts/anchor-worker.mjs`,
`lib/db.ts`, `docs/blueprints/04-contratos.md`, `docs/deploy.md`. **Comparte el
worker con WP26 → secuencial.**

CRITERIOS DE ACEPTACIÓN
- [ ] Los tres vectores del merkle v2 pasan; `merkleRoot` v1 sobre los períodos
  existentes devuelve el mismo root de siempre (regresión).
- [ ] `anchorKey` con dos refs de 200 caracteres distintos → claves distintas de
  ≤ 64 bytes (test); una clave que exceda → error, no truncado (test).
- [ ] Una firma v1 ya guardada sigue verificando; una firma v1 **nueva** se
  rechaza; una firma v2 con wallet ajena se rechaza (tests).
- [ ] Worker: fallo simulado ocho veces → `failed`, sin reintento infinito (test
  con mock de Horizon).
- [ ] Multisig documentada y probada en testnet por John (`needs_human`; no
  bloquea el resto del WP).
- [ ] Aditivo: dos columnas nullable; cero cambios sobre filas ya ancladas.

OWNER — Fausto (crypto + worker + verificación) · John (multisig, secretos) ·
Vale (lee la spec del merkle como si fuera un tercero y confirma que puede
reproducirla).
TAMAÑO — M · Estimado: 1–1,5 días + la tarea humana. Depende: WP01. Secuencial
con WP26 por el worker.
