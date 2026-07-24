# WP04 · Identidad Privy — email + wallet Stellar embebida + doble correo

CONTEXTO — Doc 15 §2: identidad email-first. La identidad ES el registro de contribuidor (ID + wallet + reputación); los correos son credenciales vinculadas. Privy soporta wallets embebidas Stellar (TEE + Shamir). `needs_human`: requiere `PRIVY_APP_ID`/`PRIVY_APP_SECRET` de John.

PROBLEMA — Freighter/wallet demo es fricción para no-cripto. Y sin doble correo, un miembro del core que salga de la org perdería acceso (no progreso, pero sí acceso).

RESULTADO ESPERADO — El invitado entra solo con su correo; la wallet Stellar se crea invisible; antes de completar perfil vincula un segundo correo; core team = @zelena.tech + personal obligatorio.

ALCANCE
- SDK Privy en `/entrar`: login por email (el correo al que llegó la invitación); crear wallet Stellar embebida; exponer pubkey al flujo de CLA existente (la firma del CLA usa la wallet embebida — compatible con WP01).
- Vinculación de segundo correo (linked account de Privy) como paso obligatorio del wizard antes de crear perfil. Para correos `@zelena.tech`: el segundo correo NO puede ser del mismo dominio.
- `users`: columna `privy_did` + tabla `user_emails (user_id, email, kind: primary|recovery, domain_flag)`. La wallet sigue siendo la clave de identidad on-chain.
- Sesión: intercambiar el token de Privy por la cookie JWT existente (la sesión interna no cambia).
- Feature flag `AUTH_PROVIDER=privy|legacy`: sin credenciales Privy, el flujo actual (Freighter/demo) sigue intacto. Scaffolding + tests con mock SÍ son ejecutables sin las keys.
- Invitaciones: el código queda ligado al email invitado además de la wallet del emisor.

NO-ALCANCE — Migrar usuarios demo existentes. SEP-30 nativo (M2). Passkeys nativas (M2). Quitar Freighter (queda como opción avanzada).

CRITERIOS DE ACEPTACIÓN
- [ ] Con flag `privy`: entrada solo con email → wallet creada → 2º correo vinculado → CLA firmado y anclado → perfil.
- [ ] Con flag `legacy`: flujo actual intacto (suite de regresión verde).
- [ ] Core team: bloqueo si el 2º correo es @zelena.tech.
- [ ] Desvincular el correo primario (simulado en test) no afecta wallet, reputación ni historial.

OWNER — Dev 1 · AGENTE: scaffolding + mocks + flag · HUMANO: crea la app en Privy, provee keys, prueba el flujo real. TIMEBOX: 1 día con keys; si no cierra → flag legacy y se reintenta en semana 2.
TAMAÑO — L · Estimado: 1 día.
