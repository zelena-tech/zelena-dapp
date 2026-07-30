# WP13 · Login SSO con Microsoft Entra ID (@zelena.tech)

CONTEXTO — Fase "organizar": el core team entra con su correo corporativo, sin códigos de invitación ni wallets. La identidad de comunidad (invitación + Privy + CLA) sigue existiendo en paralelo para la DAO — son dos puertas al mismo registro de contribuidor (doc 15 §2: la identidad ES el registro; los correos son credenciales vinculadas).

PROBLEMA — Hoy solo se entra con código de invitación + wallet. El equipo interno necesita entrar como en cualquier herramienta corporativa, y John necesita que el acceso se controle desde el tenant de Microsoft (alta/baja de personas).

RESULTADO ESPERADO — Quien tiene correo @zelena.tech entra con un click ("Continuar con Microsoft"), queda con rol `core`, y su acceso muere si Microsoft lo desactiva. La puerta de comunidad no cambia.

ALCANCE
- App registration en Entra ID (John, ver checklist) → `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`.
- NextAuth (Auth.js) con provider Microsoft Entra ID en `apps/web`. Callback intercambia la sesión de Entra por la cookie JWT interna existente — **la sesión interna no cambia** (no romper nada de lo construido).
- Restricción de tenant: solo cuentas del tenant de Zelena (validar `tid` del token). Rechazo explícito y claro para cualquier otro correo.
- `users`: `entra_oid` (único), `auth_provider` (`entra`|`invite`), `role` (`core`|`contributor`|`founder`). Reusar `user_emails` de WP04 (kind `primary`|`recovery`): el corporativo entra como `primary` de tipo corporativo.
- Alta automática al primer login: crea usuario `core` sin consumir invitación y sin exigir wallet. **El CLA sí se exige** antes del primer bounty (candado de PI del Plan Maestro §3), pero puede firmarse después del login.
- Segundo correo personal: banner persistente hasta vincularlo (obligatorio para core, doc 15 §2). No bloquea el trabajo diario; sí bloquea recibir puntos/pagos.
- Feature flag `AUTH_ENTRA_ENABLED`. Con flag apagado, el flujo actual queda intacto.

NO-ALCANCE — Tab de Teams (WP futuro). Microsoft Graph (fase automatizar). Privy (WP04, sigue `needs_human` para comunidad). Sincronización automática de bajas vía Graph — en v1 la baja se refleja porque Entra deja de emitir token.

CRITERIOS DE ACEPTACIÓN
- [ ] Login con @zelena.tech crea/recupera usuario `core` y entra al dashboard sin código de invitación.
- [ ] Correo de otro tenant: rechazado con mensaje claro (test).
- [ ] Usuario desactivado en Entra no puede iniciar sesión nueva.
- [ ] Con flag apagado: flujo de invitación+wallet intacto (suite de regresión verde).
- [ ] Un mismo humano con login Entra y wallet queda como UN registro (test de vinculación por `user_emails`), no dos.

OWNER — Dev 1 · AGENTE: NextAuth + esquema + tests con mock de Entra · HUMANO (John): app registration y secretos.
TAMAÑO — M · Estimado: 1 día con credenciales. Depende: WP00.
