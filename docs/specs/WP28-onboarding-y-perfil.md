# WP28 · Onboarding con eje y primera misión; perfil con "tu siguiente paso" y "mis aplicaciones"

CONTEXTO — `/entrar` termina en la firma del CLA. `onboard.ts` es núcleo puro con
un orden crítico (WP01, hallazgo Alta #1): la firma se verifica **antes** de
consumir la invitación. El perfil muestra reputación por eje, puntos e
invitaciones; no dice qué hacer ahora. `applications` no tiene vista para quien
aplicó — y con WP25 ya tendrá `decision_reason`.

Edge City da a cada persona una residencia temática y un lugar desde el día 1.
Aquí la persona firma y queda mirando un tablero.

PROBLEMA — La brecha B1 vista desde la persona: entra, y no pasa nada. Y las
decisiones sobre sus aplicaciones son invisibles para ella.

RESULTADO ESPERADO — Después de crear la sesión, dos pasos nuevos: elegir un eje
(orienta, no encasilla) y recibir su primera misión con mentor, para hoy. El
perfil abre con un "siguiente paso" explicable y muestra sus aplicaciones con
estado y motivo.

ALCANCE
- **`users.eje_inicial TEXT`** nullable (vía `COLUMNAS_NUEVAS`).
- **Paso 4 (eje)** ocurre **después** de `onboard()` y de la cookie de sesión: no
  toca la función núcleo ni su orden firma → invitación. Los cuatro ejes son los
  de `REPUTATION_AXES`; se puede cambiar después desde el perfil.
- **Paso 5 (primera misión)**: `tomar` automático de la misión `es_primera=1` del
  eje elegido (WP27). Mentor = persona con `tier ≥ Silver` y menos misiones en
  curso (regla pura, determinista). Si no hay misión primera para ese eje o el
  WIP está lleno → se muestra la biblioteca; **nunca se bloquea el ingreso**.
- **`lib/siguiente-paso.ts`**, función pura y explicable, al estilo del fitness:
  entrada (reputación por eje, misiones, aplicaciones, bounties `Open`, próximo
  rito) → `{ tipo, ref, porque: string[] }`. Prioridad: bounty `Open` que pida el
  eje más fuerte de la persona y sin aplicación previa → misión abierta de su eje
  → próximo rito. **Nunca compara con otras personas** (doc 16).
- **Perfil**: bloque "Tu siguiente paso" arriba; "Mis aplicaciones" (estado +
  `decision_reason` de WP25, solo las propias); "Mis misiones"; asistencia a ritos
  (WP26).
- Comparte la flag `MISSIONS_ENABLED` para los pasos 4–5.

NO-ALCANCE — Privy / email-first (WP04). Recomendador con aprendizaje. Cambiar el
orden firma → invitación. Ver aplicaciones de otras personas.

ARCHIVOS QUE TOCA — `app/entrar/page.tsx`, `app/perfil/page.tsx`,
`lib/siguiente-paso.ts` (nuevo), `lib/repo.ts`, `lib/db.ts`. Depende de las
columnas de WP25 y de las misiones de WP27; no comparte archivos de máquina de
estados con nadie.

CRITERIOS DE ACEPTACIÓN
- [ ] Con flag apagada, el onboarding actual (invitación → wallet → CLA) pasa su
  suite intacta (regresión).
- [ ] Con flag encendida: elegir eje guarda `eje_inicial` y asigna una misión
  `es_primera` de ese eje con mentor; con WIP lleno o sin misión disponible no
  lanza y muestra la biblioteca (tests).
- [ ] `sugerirSiguientePaso` es determinista y devuelve ≥ 1 razón legible en cada
  uno de cuatro escenarios de tabla (sin bounties, con bounty del eje, con misión,
  solo rito).
- [ ] La API de "mis aplicaciones" devuelve solo las de la wallet de la sesión;
  pedir las de otra wallet → 403 (test).
- [ ] Copys revisados: el siguiente paso es una oportunidad, no una evaluación;
  el motivo de una aplicación no elegida habla del bounty, no de la persona.

OWNER — David (UI de `/entrar` y perfil) · Fausto (regla pura + API) · Vale
(copys del doc 16).
TAMAÑO — M · Estimado: 1–1,5 días. Depende: WP25, WP27.
