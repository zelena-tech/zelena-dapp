/**
 * OLA — el grafo ejecutable de una ola de WPs.  Ver docs/METODOLOGIA.md.
 *
 * Esto NO es un diagrama: es la topología con guardas reales. Sustituye al hábito de
 * re-derivar las olas a mano en cada invocación, que es lo que falló el 30-jul.
 *
 *   preflight ──[verde]──▶ implementar[] ──▶ integrar ──[verde]──▶ verificar[] ──▶ reportar
 *        │                 (paralelo,            │                (paralelo,
 *        └──[rojo]─ABORTA  worktrees)            └──[rojo]─ABORTA   1 por WP)
 *
 * Guardas (aristas con condición, no adorno):
 *   · preflight rojo  → aborta. Nadie implementa sobre una base roja.
 *   · integrar rojo   → aborta ANTES de verificar. Verificar criterios sobre código
 *                       que no compila es teatro.
 *   · presupuesto bajo→ omite `verificar` y LO DICE. Nunca un recorte silencioso.
 *
 * Uso:
 *   Workflow({ name: "ola", args: { ola: "1", base: "claude/mi-rama", wps: [...] } })
 *
 * Cada WP en `args.wps`:
 *   { id: "WP20", rama: "wp/20-roster", titulo: "...",
 *     spec: "docs/specs/WP20-....md",          // opcional
 *     archivos: ["apps/web/src/lib/roles.ts"], // ARCHIVOS PROPIOS (exclusivos)
 *     prohibido: ["apps/web/src/lib/db.ts"],   // opcional
 *     tarea: "texto libre con el alcance",     // opcional si hay spec
 *     criterios: ["...", "..."] }              // opcional; si no, se leen del spec
 *
 * Si un nodo muere (límite de sesión, error de API), NO relances desde cero:
 *   Workflow({ scriptPath: "<este archivo>", resumeFromRunId: "<runId>" })
 * Los nodos completados replayean de caché y solo corre el que faltaba.
 */
export const meta = {
  name: 'ola',
  description: 'Corre una ola de WPs como grafo: preflight → implementar ∥ → integrar → verificar ∥ → reportar',
  whenToUse:
    'Para ejecutar una ola de docs/workflow-v1.2.md. Pasa {ola, base, wps[]} en args. Máximo 2 WPs por ola.',
  phases: [
    { title: 'Preflight', detail: 'baseline verde y base correcta — guarda de entrada' },
    { title: 'Implementar', detail: 'un loop por WP en worktree aislado' },
    { title: 'Integrar', detail: 'merge + suite completa — guarda de salida' },
    { title: 'Verificar', detail: 'refutación adversarial, contexto separado' },
    { title: 'Reportar', detail: 'síntesis honesta de lo verificado y lo omitido' },
  ],
}

// ---------------------------------------------------------------------------
// Configuración de la ola (args) + validación temprana: un grafo mal parametrizado
// debe fallar aquí, no a mitad de la fase de implementación.
// ---------------------------------------------------------------------------
// `args` puede llegar como objeto o —si el llamador lo serializó— como string JSON.
// Normalizar aquí importa: sin esto, un payload stringificado hacía que `cfg.wps` fuera
// undefined y el grafo reportaba "wps vacío", un diagnóstico FALSO de la causa real.
// Un guarda que miente sobre el motivo es peor que no tenerlo.
let cfg = args ?? {}
if (typeof cfg === 'string') {
  try {
    cfg = JSON.parse(cfg)
  } catch (e) {
    return { error: `args llegó como string y no es JSON válido: ${String(e)}` }
  }
}
if (typeof cfg !== 'object' || Array.isArray(cfg) || cfg === null) {
  return { error: `args debe ser un objeto {ola, base, wps[]}; llegó ${Array.isArray(cfg) ? 'un array' : typeof cfg}.` }
}

const OLA = String(cfg.ola ?? '?')
const BASE = cfg.base ?? null
const WPS = Array.isArray(cfg.wps) ? cfg.wps : []
const VERIFICAR = cfg.verificar !== false
const MAX_POR_OLA = Number(cfg.maxPorOla ?? 2)
// Coste típico de un nodo de verificación. Si no queda esto, se omite y se reporta.
const RESERVA_VERIFICACION = Number(cfg.reservaVerificacion ?? 60_000)

if (!('wps' in cfg)) {
  return { error: 'args.wps ausente. Pasa {ola, base, wps: [{id, rama, archivos, ...}]}.' }
}
if (!Array.isArray(cfg.wps)) {
  return { error: `args.wps debe ser un array; llegó ${typeof cfg.wps}.` }
}
if (WPS.length === 0) {
  return { error: 'args.wps es un array vacío: no hay nada que correr.' }
}
if (WPS.length > MAX_POR_OLA) {
  // Regla de harness aprendida el 30-jul: cuatro agentes de golpe agotaron la sesión
  // y mataron a un verificador. El tope es parte del contrato, no una sugerencia.
  return {
    error: `${WPS.length} WPs en una ola supera el tope de ${MAX_POR_OLA}. ` +
      `Divide en olas (docs/METODOLOGIA.md, capa Harness → control de ejecución).`,
  }
}
const sinArchivos = WPS.filter((w) => !Array.isArray(w.archivos) || w.archivos.length === 0)
if (sinArchivos.length > 0) {
  return {
    error: `Sin ARCHIVOS PROPIOS declarados: ${sinArchivos.map((w) => w.id).join(', ')}. ` +
      `Las aristas de este grafo SON el solapamiento de archivos: sin eso no se puede paralelizar.`,
  }
}
// Solapamiento entre WPs de la misma ola = no son paralelizables. Es la regla del grafo.
const cruce = []
for (let i = 0; i < WPS.length; i++) {
  for (let j = i + 1; j < WPS.length; j++) {
    const comunes = WPS[i].archivos.filter((f) => WPS[j].archivos.includes(f))
    if (comunes.length > 0) cruce.push(`${WPS[i].id} ∩ ${WPS[j].id}: ${comunes.join(', ')}`)
  }
}
if (cruce.length > 0) {
  return { error: `WPs de la misma ola comparten archivos — secuéncialos:\n${cruce.join('\n')}` }
}

// ---------------------------------------------------------------------------
// Contexto común: la capa de política del harness que todo nodo recibe.
// ---------------------------------------------------------------------------
const HARNESS = `
Trabajas en el repo **zelena-dapp** (monorepo npm; la app es \`apps/web\`, Next.js 14 + TypeScript estricto).

## Arranque obligatorio
1. Lee \`CLAUDE.md\` — sus guardrails son LEY.
2. Lee \`docs/METODOLOGIA.md\` — cómo se trabaja aquí (harness / loop / graph).
3. \`npm install\` desde la raíz si tu worktree no tiene node_modules.

## Evidencia (el grader de este repo — no se hace loop sobre la confianza)
\`\`\`
cd apps/web && npx vitest run    # la suite COMPLETA verde, no solo tus tests
npx tsc --noEmit                 # limpio
npx next lint                    # sin errores
\`\`\`
"Creo que funciona" no es condición de parada. La evidencia lo es.

## Guardrails no negociables
- NO toques: \`main\`, \`.env*\` (documenta variables en \`docs/deploy.md\`), secretos, mainnet, fondos.
- No \`git push\`, no merge a otras ramas, no deploy.
- Capa de datos ÚNICA y **síncrona**: \`apps/web/src/lib/db.ts\`. Todo SQL nuevo se traduce a
  T-SQL en producción (\`lib/sql-dialect.ts\`): usa SQL simple, columnas booleanas con prefijo \`is_\`.
- Parámetros nuevos del sistema → **genoma versionado** (\`lib/genome.ts\`), nunca hardcodeados.
- Reglas de producto (doc 16): jamás confiscar puntos; **se califican entregas, nunca personas**;
  toda comparación muestra el progreso propio al lado.
- Nada de la fase "automatizar": sin Graph, sin correos, sin notificaciones, sin telemetría de presencia.
- **Roles, no personas** (docs/workflow-v1.2.md): nada de cablear a un humano concreto.
`

const SCHEMA_IMPL = {
  type: 'object', additionalProperties: false,
  required: ['wp', 'rama', 'commit', 'evidencia', 'criterios', 'decisiones', 'archivos', 'huecos'],
  properties: {
    wp: { type: 'string' }, rama: { type: 'string' },
    commit: { type: 'string', description: 'hash corto, o "" si quedó bloqueado' },
    estado: { type: 'string', enum: ['done', 'blocked'] },
    evidencia: {
      type: 'object', additionalProperties: false,
      required: ['tests_pasados', 'tests_total', 'verde', 'tsc_limpio', 'lint_limpio'],
      properties: {
        tests_pasados: { type: 'integer' }, tests_total: { type: 'integer' },
        verde: { type: 'boolean' }, tsc_limpio: { type: 'boolean' }, lint_limpio: { type: 'boolean' },
      },
    },
    criterios: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['criterio', 'cumplido', 'prueba'],
        properties: {
          criterio: { type: 'string' },
          cumplido: { type: 'string', enum: ['si', 'parcial', 'no'] },
          prueba: { type: 'string', description: 'test o archivo:línea que lo demuestra' },
        },
      },
    },
    decisiones: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['decision', 'porque'],
        properties: { decision: { type: 'string' }, porque: { type: 'string' } },
      },
    },
    env_vars: { type: 'array', items: { type: 'string' } },
    archivos: { type: 'array', items: { type: 'string' } },
    huecos: { type: 'array', items: { type: 'string' } },
  },
}

// ---------------------------------------------------------------------------
// NODO 1 · preflight — guarda de entrada
// ---------------------------------------------------------------------------
phase('Preflight')
log(`Ola ${OLA}: ${WPS.map((w) => w.id).join(' ∥ ')}`)

const pre = await agent(`${HARNESS}

# NODO preflight — guarda de entrada de la ola ${OLA}

No implementes NADA. Solo verifica que la base está sana y reporta.

1. \`git log --oneline -1\` y \`git status --short\`. ${BASE ? `La rama debe ser \`${BASE}\`.` : ''}
2. ¿El árbol está limpio? Un árbol sucio contamina los worktrees de la ola.
3. \`npm install\` desde la raíz y luego \`cd apps/web && npx vitest run\`.
4. Reporta el número exacto de tests y si la suite está verde.
5. Confirma que existen los archivos que la ola va a tocar (o que no existen, si son nuevos):
${WPS.map((w) => `   - ${w.id}: ${w.archivos.join(', ')}`).join('\n')}

Sé literal: si la suite está roja o el árbol sucio, dilo con el detalle exacto. Esta guarda
existe para que nadie implemente sobre una base roja.`,
  {
    label: 'preflight', phase: 'Preflight', effort: 'low',
    schema: {
      type: 'object', additionalProperties: false,
      required: ['base_ok', 'arbol_limpio', 'suite_verde', 'tests', 'commit', 'notas'],
      properties: {
        base_ok: { type: 'boolean' }, arbol_limpio: { type: 'boolean' },
        suite_verde: { type: 'boolean' }, tests: { type: 'integer' },
        commit: { type: 'string' }, notas: { type: 'array', items: { type: 'string' } },
      },
    },
  })

// GUARDA: sin base sana no se entra a la ola.
if (!pre || !pre.suite_verde || !pre.base_ok) {
  log('⛔ ABORTADA en preflight: la base no está sana.')
  return {
    ola: OLA, abortada_en: 'preflight',
    motivo: !pre ? 'el nodo preflight no devolvió resultado'
      : !pre.base_ok ? 'la rama base no es la esperada'
      : `la suite no está verde (${pre.tests} tests)`,
    preflight: pre,
    siguiente_paso: 'Arregla la base antes de relanzar. Ningún WP se implementó.',
  }
}
log(`✅ preflight: base ${pre.commit}, ${pre.tests} tests verdes${pre.arbol_limpio ? '' : ' (⚠️ árbol sucio)'}`)

// ---------------------------------------------------------------------------
// NODO 2 · implementar[] — un loop por WP, en paralelo, worktrees aislados
// ---------------------------------------------------------------------------
phase('Implementar')

const impl = await parallel(
  WPS.map((wp) => () =>
    agent(`${HARNESS}

# NODO implementar · ${wp.id} — ${wp.titulo ?? ''}
RAMA: \`${wp.rama}\`
${wp.spec ? `SPEC: \`${wp.spec}\` — léelo COMPLETO. El NO-ALCANCE es LEY.` : ''}

Base verificada: ${pre.commit} con ${pre.tests} tests verdes. Si tu worktree no coincide con esa
base, rebásate sobre ${BASE ?? 'la rama de integración'} ANTES de escribir nada y confírmalo.

## ARCHIVOS PROPIOS (exclusivos — otro nodo corre en paralelo)
${wp.archivos.map((f) => `- \`${f}\``).join('\n')}
${wp.prohibido?.length ? `\n## PROHIBIDO\n${wp.prohibido.map((f) => `- \`${f}\``).join('\n')}` : ''}

Tocar un archivo fuera de tu lista provoca conflicto de merge. Si crees que lo necesitas,
NO lo edites: anótalo en \`huecos\` y sigue.

${wp.tarea ? `## Alcance\n${wp.tarea}\n` : ''}
${wp.criterios?.length ? `## Criterios de aceptación\n${wp.criterios.map((c) => `- [ ] ${c}`).join('\n')}\n` : ''}

## Tu loop (parada por EVIDENCIA, con tope)
1. Implementa el alcance.
2. Corre el grader completo (vitest + tsc + lint).
3. Rojo → arregla. **Tope: 2 intentos serios.** Si sigue rojo, revierte a estado limpio,
   devuelve \`estado: "blocked"\` con el motivo real en \`huecos\`, y NO commitees código roto.
4. Verde → \`git switch -c ${wp.rama}\` y UN commit convencional
   \`feat(${wp.id.toLowerCase()}): …\` terminando en
   \`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\`. Sin push, sin merge.

## Honestidad
Un criterio no cumplido se reporta como \`no\` o \`parcial\` con el motivo. Un hueco declarado es
aceptable; uno oculto no. No infles: el nodo de verificación va a abrir tus archivos.`,
      {
        label: `impl:${wp.id}`, phase: 'Implementar', schema: SCHEMA_IMPL,
        isolation: 'worktree', effort: 'high',
      })
  )
)

const logrados = impl.filter((r) => r && r.commit && r.estado !== 'blocked')
const fallidos = WPS.map((wp, i) => ({ wp, r: impl[i] })).filter(({ r }) => !r || !r.commit || r.estado === 'blocked')
for (const { wp, r } of fallidos) {
  log(`⚠️ ${wp.id}: ${!r ? 'el nodo murió sin resultado' : 'bloqueado — ' + (r.huecos?.[0] ?? 'sin motivo')}`)
}
if (logrados.length === 0) {
  log('⛔ ABORTADA: ningún WP produjo commit.')
  return {
    ola: OLA, abortada_en: 'implementar', preflight: pre, implementaciones: impl,
    siguiente_paso: 'Revisa los motivos de bloqueo. Nada que integrar.',
  }
}
log(`✅ implementar: ${logrados.map((r) => `${r.wp}@${r.commit}`).join(' · ')}`)

// ---------------------------------------------------------------------------
// NODO 3 · integrar — merge + grader completo. Guarda de salida.
// ---------------------------------------------------------------------------
phase('Integrar')

const integ = await agent(`${HARNESS}

# NODO integrar — ola ${OLA}

Ramas a integrar en \`${BASE ?? 'la rama actual'}\`, en este orden:
${logrados.map((r) => `- \`${r.rama}\` (${r.wp} @ ${r.commit})`).join('\n')}

1. Verifica que estás en ${BASE ? `\`${BASE}\`` : 'la rama de integración'} con el árbol limpio.
2. \`git merge --no-ff <rama>\` una por una. Si hay conflicto: resuélvelo **conservando la
   intención de ambos** y explica en \`notas\` qué decidiste y por qué.
3. \`npm install\` desde la raíz (por si alguna rama añadió dependencias) y commitea el lockfile
   si cambió.
4. Corre el grader COMPLETO: \`npx vitest run\`, \`npx tsc --noEmit\`, \`npx next lint\`,
   \`npx next build\`. **Los cuatro.**
5. Si algo se rompe **por la integración** (no por un WP suelto), arréglalo — es exactamente el
   tipo de bug que solo aparece al juntar el trabajo — y commitea aparte como
   \`fix(ola${OLA}): …\`. Tope: 2 intentos serios.
6. Reporta los números exactos.

Estos WPs declararon estos huecos; míralos por si alguno se resuelve al integrar o se agrava:
${logrados.flatMap((r) => (r.huecos ?? []).map((h) => `- ${r.wp}: ${h}`)).join('\n') || '- (ninguno)'}`,
  {
    label: 'integrar', phase: 'Integrar', effort: 'high',
    schema: {
      type: 'object', additionalProperties: false,
      required: ['verde', 'tests_pasados', 'tests_total', 'tsc_limpio', 'lint_limpio', 'build_verde', 'commit', 'notas'],
      properties: {
        verde: { type: 'boolean' }, tests_pasados: { type: 'integer' }, tests_total: { type: 'integer' },
        tsc_limpio: { type: 'boolean' }, lint_limpio: { type: 'boolean' }, build_verde: { type: 'boolean' },
        commit: { type: 'string' }, conflictos: { type: 'array', items: { type: 'string' } },
        arreglos: { type: 'array', items: { type: 'string' } }, notas: { type: 'array', items: { type: 'string' } },
      },
    },
  })

// GUARDA: verificar criterios sobre código que no compila es teatro.
const integrado = !!integ && integ.verde && integ.tsc_limpio && integ.lint_limpio
if (!integrado) {
  log('⛔ ABORTADA en integrar: no se verifica sobre una integración roja.')
  return {
    ola: OLA, abortada_en: 'integrar', preflight: pre, implementaciones: impl, integracion: integ,
    siguiente_paso:
      'Arregla la integración a mano y luego corre SOLO la fase de verificación ' +
      '(relanza con resumeFromRunId para no repetir la implementación).',
  }
}
log(`✅ integrar: ${integ.tests_pasados}/${integ.tests_total} verde · build ${integ.build_verde ? 'verde' : 'no corrido'}`)

// ---------------------------------------------------------------------------
// NODO 4 · verificar[] — refutación adversarial, contexto separado.
// Guarda de presupuesto: si no alcanza, se OMITE y SE DICE. Nunca recorte silencioso.
// ---------------------------------------------------------------------------
const presupuestoAlcanza =
  !budget.total || budget.remaining() > RESERVA_VERIFICACION * logrados.length
let verificaciones = []
let verificacion_omitida = null

if (!VERIFICAR) {
  verificacion_omitida = 'desactivada por args.verificar=false'
} else if (!presupuestoAlcanza) {
  verificacion_omitida =
    `presupuesto insuficiente: quedan ~${Math.round(budget.remaining() / 1000)}k tokens y se ` +
    `necesitan ~${Math.round((RESERVA_VERIFICACION * logrados.length) / 1000)}k para ${logrados.length} nodo(s). ` +
    `Relanza la verificación con resumeFromRunId cuando haya presupuesto.`
  log(`⚠️ verificar OMITIDO — ${verificacion_omitida}`)
} else {
  phase('Verificar')
  verificaciones = await parallel(
    logrados.map((r) => () =>
      agent(`${HARNESS}

# NODO verificar · ${r.wp} — intenta REFUTAR

Otro agente implementó ${r.wp} en \`${r.rama}\` (commit \`${r.commit}\`) y declaró los criterios de
abajo como cumplidos. **Tu trabajo no es confirmar: es refutar.** Contexto separado a propósito —
tú no escribiste este código.

Para cada criterio: abre el archivo citado, comprueba que la línea y la cita EXISTEN y que la
interpretación es correcta, y corre la prueba que menciona. Busca lo que se le pudo pasar:
- ¿la prueba realmente prueba el criterio, o pasa por otra razón?
- ¿hay un camino de código que lo elude (otra ruta, otro rol, otro estado)?
- ¿se cumplió el criterio o solo el test que el propio agente escribió?
- ¿el NO-ALCANCE del spec se respetó, o se colaron cosas de más?

CRITERIOS DECLARADOS:
${(r.criterios ?? []).map((c) => `- [${c.cumplido}] ${c.criterio}\n    prueba: ${c.prueba}`).join('\n') || '- (no declaró criterios)'}

DECISIONES DECLARADAS (¿son razonables, o esconden un atajo?):
${(r.decisiones ?? []).map((d) => `- ${d.decision} → ${d.porque}`).join('\n') || '- (ninguna)'}

HUECOS DECLARADOS (¿están completos, o hay más que no vio?):
${(r.huecos ?? []).map((h) => `- ${h}`).join('\n') || '- (ninguno)'}

**Solo lectura**: no arregles nada, no commitees. Reporta. Si en duda tras verificar, di
\`parcial\` y explica qué parte sí y qué parte no.`,
        {
          label: `verify:${r.wp}`, phase: 'Verificar', effort: 'high',
          schema: {
            type: 'object', additionalProperties: false,
            required: ['wp', 'veredictos', 'hallazgos_nuevos'],
            properties: {
              wp: { type: 'string' },
              veredictos: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false,
                  required: ['criterio', 'veredicto', 'nota'],
                  properties: {
                    criterio: { type: 'string' },
                    veredicto: { type: 'string', enum: ['confirmado', 'refutado', 'parcial'] },
                    nota: { type: 'string' },
                  },
                },
              },
              hallazgos_nuevos: {
                type: 'array',
                description: 'problemas que el implementador NO declaró',
                items: {
                  type: 'object', additionalProperties: false,
                  required: ['titulo', 'severidad', 'evidencia'],
                  properties: {
                    titulo: { type: 'string' },
                    severidad: { type: 'string', enum: ['alta', 'media', 'baja'] },
                    evidencia: { type: 'string', description: 'archivo:línea' },
                  },
                },
              },
            },
          },
        })
    )
  )
  const refutados = verificaciones.filter(Boolean).flatMap((v) =>
    (v.veredictos ?? []).filter((x) => x.veredicto === 'refutado').map((x) => `${v.wp}: ${x.criterio}`))
  const nuevos = verificaciones.filter(Boolean).flatMap((v) => v.hallazgos_nuevos ?? [])
  log(`✅ verificar: ${refutados.length} criterio(s) refutado(s), ${nuevos.length} hallazgo(s) nuevo(s)`)
}

// ---------------------------------------------------------------------------
// NODO 5 · reportar — síntesis. Lo no verificado se marca POR CONSTRUCCIÓN.
// ---------------------------------------------------------------------------
phase('Reportar')

const sinVerificar = verificacion_omitida
  ? logrados.map((r) => r.wp)
  : logrados.filter((r) => !verificaciones.some((v) => v && v.wp === r.wp)).map((r) => r.wp)

return {
  ola: OLA,
  completada: true,
  base: pre.commit,
  preflight: { tests: pre.tests, arbol_limpio: pre.arbol_limpio },
  implementaciones: impl,
  bloqueados: fallidos.map(({ wp, r }) => ({ wp: wp.id, motivo: r?.huecos?.[0] ?? 'nodo sin resultado' })),
  integracion: {
    tests: `${integ.tests_pasados}/${integ.tests_total}`,
    build_verde: integ.build_verde,
    commit: integ.commit,
    conflictos: integ.conflictos ?? [],
    arreglos: integ.arreglos ?? [],
  },
  verificaciones,
  // Estos dos campos son la guarda del reporte: quien lea el resultado no puede
  // confundir "no verificado" con "verificado y correcto".
  verificacion_omitida,
  wps_sin_verificar: sinVerificar,
  presupuesto: budget.total
    ? { gastado_k: Math.round(budget.spent() / 1000), restante_k: Math.round(budget.remaining() / 1000) }
    : null,
  siguiente_paso:
    'Actualiza docs/specs/QUEUE.md (estado + registro de cierres con hash) y, si la ola cierra ' +
    'una fase, escribe el reporte en docs/specs/. Los criterios refutados vuelven a la cola como FBxx.',
}
