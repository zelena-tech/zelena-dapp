# WP01 · Verificación criptográfica de la firma de wallet (Alta #1)

CONTEXTO — Hallazgo Alta #1 del security review: en el onboarding, el servidor confía en la firma que envía el cliente sin verificarla criptográficamente. Aceptable en demo; inaceptable con cohorte real. Bloquea el deploy público.

PROBLEMA — Cualquiera podría suplantar una wallet enviando una firma inventada; el CLA anclado perdería su valor de no-repudio.

RESULTADO ESPERADO — El servidor verifica ed25519 que la firma del hash del CLA corresponde a la pubkey Stellar declarada, con protección anti-replay entre redes.

ALCANCE
- `lib/crypto.ts`: función `verifyWalletSignature(pubkey, payload, signature)` usando el SDK de Stellar (ed25519). Payload = hash CLA + domain separator (`zelena-cla-testnet-v1`) para evitar replay entre redes/contextos (riesgo documentado en security-review.md).
- `/api/onboard` y `/api/cla`: rechazar (400) firma inválida ANTES de consumir la invitación (el consumo atómico no debe gastarse con firmas falsas).
- Wallet demo (`is_demo=true`): mismo flujo de verificación — el keypair demo firma de verdad client-side; el servidor verifica igual.
- Tests: firma válida pasa · firma inválida rechaza · firma válida de otra pubkey rechaza · payload sin domain separator rechaza · invitación NO se consume en rechazo.

NO-ALCANCE — SEP-10 completo (es M2). Cambios al flujo de UI de /entrar. Passkeys.

CRITERIOS DE ACEPTACIÓN
- [ ] Onboarding con firma inválida devuelve 400 y la invitación sigue utilizable.
- [ ] Test de replay (firma válida con domain separator de otra red) rechaza.
- [ ] Suite completa verde; flujo demo sigue funcionando end-to-end en localhost.

OWNER — Dev 1 · AGENTE: implementación + tests · HUMANO: revisa la construcción del payload firmado (superficie crítica).
TAMAÑO — M · Estimado: medio día. Spec técnico detallado: `docs/security-review.md` hallazgo #1.
